#!/usr/bin/env python3
"""
TDIR Workshop Reset and Verification

Facilitator tooling, not a participant shortcut. Participants should keep running the recovery
commands by hand — that is the exercise. This script exists for two other jobs:

  --verify   assert the environment is session-ready, before anyone starts
  --recover  perform the recovery correctly, to restore the environment between sessions

The recovery path is also the reference implementation for the workshop's own recovery step.
Several things about recovering a poisoned Bedrock knowledge base are counter-intuitive and were
established by testing against a live environment:

1. Retrieval serves the S3 Vectors index, not the S3 objects. Deleting documents — or denying all
   access to the bucket — does not stop the poisoned content being returned. Only an ingestion job
   evicts the embeddings. A "quarantine" that stops at the bucket policy leaves the agent poisoned
   while appearing to have contained the incident.

2. `aws s3 rm` on a versioned bucket writes a delete marker; it does not delete a version and does
   not restore the previous one. Recovering a document that was tampered with *in place* requires
   deleting the current version by id, which promotes the clean version back to latest.

3. The corpus contains a document that was overwritten in place and whose metadata still claims
   `verified: true`. Filtering on `verified: false` finds the four planted files and misses this
   one. Nor is version count sufficient: re-seeding re-uploads every document, so after a couple of
   runs every key has several versions. The reliable signal is comparing content across versions —
   a current version carrying adversarial markers where an earlier one does not.

4. The cleanup ingestion cannot run while the bucket is quarantined — the knowledge base's own
   crawler needs `s3:ListBucket` and `s3:GetObject` on the bucket the quarantine denies. Lift the
   quarantine first, or the job fails.

Usage:
    python tdir-reset.py --verify                 # read-only readiness check
    python tdir-reset.py --recover                # clean corpus + re-ingest + lift containment
    python tdir-reset.py --recover --dry-run      # show what recovery would do

Prerequisites:
    - AWS credentials with read access, and write access for --recover
    - Workshop stack deployed with the tdir preset
"""

import argparse
import json
import logging
import sys
import time

import boto3
from botocore.exceptions import ClientError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Published by lib/constructs/tdir-knowledge-base.ts and tdir-escalated-role.ts. Resolved from SSM
# rather than hardcoded: ids are service-generated and bucket names carry a CloudFormation suffix.
SSM_KB_ID = "tdir/knowledgebaseid"
SSM_KB_BUCKET = "tdir/knowledgebasebucket"
SSM_KB_DATA_SOURCE = "tdir/knowledgebasedatasourceid"
DEFAULT_PREFIX = "/petstore"

ESCALATED_ROLE_NAME = "AgentEscalatedAccess"
CONTAINMENT_POLICY_NAME = "SecurityIncidentDenyAll"
QUARANTINE_SID = "SecurityIncidentQuarantine"
RUNTIME_POLICY_SID = "SecurityIncidentDenyInvoke"

# Planted files, flagged verified=false. The tampered legitimate document is deliberately absent:
# it is found by diffing versions rather than by name, so this list going stale matters less.
PLANTED_DOCUMENTS = (
    "products/special-offers-internal.txt",
    "products/supplier-api-config.txt",
    "products/agent-maintenance-notes.txt",
    "products/cross-agent-coordination.txt",
)

# Marker that identifies adversarial content in a document body, for verification.
POISON_MARKERS = (
    "SYSTEM OVERRIDE",
    "c2-relay.external-audit.example.com",
    "MAINTENANCE DIRECTIVE",
)


def resolve(ssm, prefix, short_name):
    """Read one SSM parameter, returning '' when absent so callers can report rather than crash."""
    try:
        return ssm.get_parameter(Name=f"{prefix}/{short_name}")["Parameter"]["Value"]
    except ClientError:
        return ""


def object_versions(s3, bucket):
    """All versions per key under products/, newest first."""
    versions = {}
    token = {}
    while True:
        response = s3.list_object_versions(Bucket=bucket, Prefix="products/", **token)
        for version in response.get("Versions", []):
            versions.setdefault(version["Key"], []).append(version)
        if not response.get("IsTruncated"):
            break
        token = {
            "KeyMarker": response["NextKeyMarker"],
            "VersionIdMarker": response["NextVersionIdMarker"],
        }
    for key in versions:
        versions[key].sort(key=lambda v: v["LastModified"], reverse=True)
    return versions


def _body(s3, bucket, key, version_id):
    return (
        s3.get_object(Bucket=bucket, Key=key, VersionId=version_id)["Body"]
        .read()
        .decode("utf-8", "replace")
    )


def tampered_documents(s3, bucket):
    """
    Documents whose current version carries adversarial content while an earlier version does not.

    Deliberately *not* "any key with more than one version". Version count alone identifies the
    tampered document only on a first seeding; re-seeding re-uploads every file, so after a couple
    of runs every key has multiple versions and the count says nothing. Comparing content across
    versions is stable however many times the environment has been re-seeded.

    Metadata is no help here either: the tampered document still claims `verified: true`, which is
    the entire point of the versioning exercise.
    """
    result = {}
    for key, versions in object_versions(s3, bucket).items():
        if len(versions) < 2:
            continue
        latest, older = versions[0], versions[1:]
        try:
            if not any(
                marker in _body(s3, bucket, key, latest["VersionId"])
                for marker in POISON_MARKERS
            ):
                continue
            clean = [
                v
                for v in older
                if not any(
                    marker in _body(s3, bucket, key, v["VersionId"])
                    for marker in POISON_MARKERS
                )
            ]
        except ClientError:
            continue
        if clean:
            result[key] = versions
    return result


def restore_tampered(s3, bucket, key, versions, dry_run):
    """
    Delete the current version so the previous, clean version becomes latest.

    Not `aws s3 rm`: on a versioned bucket that writes a delete marker and the object disappears
    entirely instead of reverting.
    """
    latest = next(
        (v for v in versions if v.get("IsLatest")),
        versions[0] if versions else None,
    )
    if latest is None:
        return f"{key}: no current version found"
    if dry_run:
        return f"DRY-RUN would delete version {latest['VersionId']} of {key}, promoting the previous version"
    s3.delete_object(Bucket=bucket, Key=key, VersionId=latest["VersionId"])
    return f"reverted {key} to its previous version"


def lift_bucket_quarantine(s3, bucket, dry_run):
    """
    Remove only the quarantine statement, leaving the rest of the bucket policy intact.

    `delete-bucket-policy` would also drop the TLS-enforcement deny and the grant the CDK
    auto-delete custom resource needs, and without that grant `cdk destroy` cannot empty the
    bucket and stack deletion fails.
    """
    try:
        policy = json.loads(s3.get_bucket_policy(Bucket=bucket)["Policy"])
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "NoSuchBucketPolicy":
            return "no bucket policy present"
        raise

    remaining = [
        st for st in policy.get("Statement", []) if st.get("Sid") != QUARANTINE_SID
    ]
    if len(remaining) == len(policy.get("Statement", [])):
        return "no quarantine statement present"
    if dry_run:
        return f"DRY-RUN would remove the {QUARANTINE_SID} statement, keeping {len(remaining)} others"

    if remaining:
        policy["Statement"] = remaining
        s3.put_bucket_policy(Bucket=bucket, Policy=json.dumps(policy))
        return (
            f"quarantine lifted, {len(remaining)} pre-existing statement(s) preserved"
        )
    # Only the quarantine was present, so the bucket had no policy of its own beforehand.
    s3.delete_bucket_policy(Bucket=bucket)
    return "quarantine lifted (it was the only statement)"


def ingest(agent, kb_id, data_source_id, dry_run, wait=True):
    """Start an ingestion job and wait for it, reporting the eviction counts."""
    if dry_run:
        return "DRY-RUN would start an ingestion job to re-sync the vector index"
    job = agent.start_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=data_source_id)
    job_id = job["ingestionJob"]["ingestionJobId"]
    if not wait:
        return f"ingestion job {job_id} started"
    for _ in range(60):
        state = agent.get_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=data_source_id,
            ingestionJobId=job_id,
        )["ingestionJob"]
        if state["status"] in ("COMPLETE", "FAILED"):
            stats = state.get("statistics", {})
            summary = (
                f"scanned={stats.get('numberOfDocumentsScanned')} "
                f"indexed={stats.get('numberOfNewDocumentsIndexed')} "
                f"deleted={stats.get('numberOfDocumentsDeleted')}"
            )
            if state["status"] == "FAILED":
                return f"ingestion FAILED: {state.get('failureReasons')}"
            return f"ingestion COMPLETE ({summary})"
        time.sleep(10)
    return f"ingestion job {job_id} still running after 10 minutes"


def lift_role_containment(iam, dry_run):
    """Remove the deny-all containment policy from the escalated role, if present."""
    try:
        iam.get_role_policy(
            RoleName=ESCALATED_ROLE_NAME,
            PolicyName=CONTAINMENT_POLICY_NAME,
        )
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in ("NoSuchEntity",):
            return f"{CONTAINMENT_POLICY_NAME} not attached"
        raise
    if dry_run:
        return (
            f"DRY-RUN would delete {CONTAINMENT_POLICY_NAME} from {ESCALATED_ROLE_NAME}"
        )
    iam.delete_role_policy(
        RoleName=ESCALATED_ROLE_NAME,
        PolicyName=CONTAINMENT_POLICY_NAME,
    )
    return f"removed {CONTAINMENT_POLICY_NAME} from {ESCALATED_ROLE_NAME}"


def lift_runtime_containment(region, dry_run):
    """
    Remove the deny-invoke resource policy from any contained agent runtime.

    There is no start/restart API — a runtime is never stopped, so re-enabling it means deleting
    the resource policy that denies InvokeAgentRuntime.
    """
    actions = []
    try:
        control = boto3.client("bedrock-agentcore-control", region_name=region)
        runtimes = control.list_agent_runtimes().get("agentRuntimes", [])
    except (
        Exception
    ) as exc:  # noqa: BLE001 - service may be unavailable in this boto3/region
        return [f"could not list agent runtimes: {type(exc).__name__}"]

    for runtime in runtimes:
        arn = runtime.get("agentRuntimeArn")
        name = runtime.get("agentRuntimeName", "<unnamed>")
        if not arn:
            continue
        try:
            policy = control.get_resource_policy(resourceArn=arn).get("policy", "")
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("ResourceNotFoundException",):
                continue
            raise
        if RUNTIME_POLICY_SID not in policy:
            continue
        if dry_run:
            actions.append(
                f"DRY-RUN would delete the deny-invoke resource policy on {name}",
            )
            continue
        control.delete_resource_policy(resourceArn=arn)
        actions.append(f"re-enabled {name}: deny-invoke resource policy removed")
    return actions or ["no runtime carries a containment policy"]


def verify(s3, agent, iam, region, kb_id, bucket, data_source_id):
    """Read-only readiness check. Returns a list of (ok, message) tuples."""
    results = []

    results.append((bool(kb_id), f"knowledge base id resolved: {kb_id or 'MISSING'}"))
    results.append(
        (bool(bucket), f"knowledge base bucket resolved: {bucket or 'MISSING'}"),
    )
    results.append(
        (
            bool(data_source_id),
            f"data source id resolved: {data_source_id or 'MISSING (needed to re-ingest)'}",
        ),
    )
    if not (kb_id and bucket):
        return results

    objects = s3.list_objects_v2(Bucket=bucket, Prefix="products/").get("Contents", [])
    keys = {o["Key"] for o in objects}
    missing = [d for d in PLANTED_DOCUMENTS if d not in keys]
    results.append(
        (
            not missing,
            f"planted documents present: {len(PLANTED_DOCUMENTS) - len(missing)}/"
            f"{len(PLANTED_DOCUMENTS)}" + (f" missing {missing}" if missing else ""),
        ),
    )

    tampered = tampered_documents(s3, bucket)
    results.append(
        (
            bool(tampered),
            "in-place tampering present: "
            + (
                str(sorted(tampered))
                if tampered
                else "NONE - the versioning exercise has no subject"
            ),
        ),
    )

    # The bucket must be readable, or the cleanup ingestion cannot run.
    quarantined = False
    try:
        policy = json.loads(s3.get_bucket_policy(Bucket=bucket)["Policy"])
        quarantined = any(
            st.get("Sid") == QUARANTINE_SID for st in policy.get("Statement", [])
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "NoSuchBucketPolicy":
            raise
    results.append(
        (
            not quarantined,
            (
                "bucket not quarantined"
                if not quarantined
                else "bucket IS quarantined - lift it before re-ingesting"
            ),
        ),
    )

    # Retrieval is the only check that proves the scenario actually works: the poison has to be in
    # the index, not merely in the bucket.
    try:
        runtime = boto3.client("bedrock-agent-runtime", region_name=region)
        hits = runtime.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={"text": "do you have any special offers or discounts?"},
        ).get("retrievalResults", [])
        blob = " ".join(h.get("content", {}).get("text", "") for h in hits)
        found = [m for m in POISON_MARKERS if m in blob]
        results.append(
            (
                bool(found),
                f"adversarial content retrievable from the index: {found or 'NO - re-seed needed'}",
            ),
        )
    except Exception as exc:  # noqa: BLE001
        results.append((False, f"retrieval check failed: {type(exc).__name__}: {exc}"))

    # Leftover containment from a previous session would make the next one behave oddly.
    try:
        iam.get_role_policy(
            RoleName=ESCALATED_ROLE_NAME,
            PolicyName=CONTAINMENT_POLICY_NAME,
        )
        results.append(
            (
                False,
                f"{ESCALATED_ROLE_NAME} still carries {CONTAINMENT_POLICY_NAME} from a previous run",
            ),
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "NoSuchEntity":
            results.append((True, f"{ESCALATED_ROLE_NAME} is not contained"))
        else:
            raise

    return results


def main():
    parser = argparse.ArgumentParser(
        description="TDIR workshop reset and verification (facilitator tooling)",
    )
    parser.add_argument("--region", default="us-east-1", help="AWS region")
    parser.add_argument(
        "--parameter-prefix",
        default=DEFAULT_PREFIX,
        help="SSM prefix (default /petstore)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="read-only readiness check",
    )
    parser.add_argument(
        "--recover",
        action="store_true",
        help="perform recovery correctly",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="with --recover, show actions without making them",
    )
    parser.add_argument(
        "--no-wait",
        action="store_true",
        help="do not wait for the ingestion job",
    )
    args = parser.parse_args()

    if not (args.verify or args.recover):
        parser.error("choose --verify or --recover")

    ssm = boto3.client("ssm", region_name=args.region)
    s3 = boto3.client("s3", region_name=args.region)
    agent = boto3.client("bedrock-agent", region_name=args.region)
    iam = boto3.client("iam")

    kb_id = resolve(ssm, args.parameter_prefix, SSM_KB_ID)
    bucket = resolve(ssm, args.parameter_prefix, SSM_KB_BUCKET)
    data_source_id = resolve(ssm, args.parameter_prefix, SSM_KB_DATA_SOURCE)

    if args.verify:
        logger.info("Verifying the environment is session-ready...")
        results = verify(s3, agent, iam, args.region, kb_id, bucket, data_source_id)
        for ok, message in results:
            logger.info("  %s %s", "PASS" if ok else "FAIL", message)
        failures = [m for ok, m in results if not ok]
        if failures:
            logger.error(
                "%d check(s) failed - the environment is not session-ready",
                len(failures),
            )
            return 1
        logger.info("All checks passed.")
        return 0

    logger.info("Recovering the environment%s...", " (dry run)" if args.dry_run else "")
    if not (kb_id and bucket and data_source_id):
        logger.error(
            "Could not resolve knowledge base id, bucket and data source id from SSM under %s",
            args.parameter_prefix,
        )
        return 1

    actions = []

    # Order matters: the quarantine must come off before ingestion, or the crawler is denied.
    actions.append(lift_bucket_quarantine(s3, bucket, args.dry_run))

    for key, versions in sorted(tampered_documents(s3, bucket).items()):
        actions.append(restore_tampered(s3, bucket, key, versions, args.dry_run))

    for key in PLANTED_DOCUMENTS:
        try:
            s3.head_object(Bucket=bucket, Key=key)
        except ClientError:
            actions.append(f"{key}: already absent")
            continue
        if args.dry_run:
            actions.append(f"DRY-RUN would delete {key}")
        else:
            s3.delete_object(Bucket=bucket, Key=key)
            actions.append(f"deleted {key}")

    # Without this the corpus looks clean while retrieval still serves the poisoned embeddings.
    actions.append(
        ingest(agent, kb_id, data_source_id, args.dry_run, wait=not args.no_wait),
    )

    actions.append(lift_role_containment(iam, args.dry_run))
    actions.extend(lift_runtime_containment(args.region, args.dry_run))

    for action in actions:
        logger.info("  %s", action)
    logger.info(
        "Recovery complete. Re-run tdir-seed-scenarios.py to plant the scenario again.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
