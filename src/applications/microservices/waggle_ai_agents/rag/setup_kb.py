"""Provision the nutrition RAG: Bedrock Knowledge Base on S3 Vectors."""

from __future__ import annotations

import json
import time
from pathlib import Path

import boto3

from waggle_ai_agents.common import (
    config,
)  # region/prefix (honors .env, forces us-east-1)

REGION = config.AWS_REGION
EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0"
EMBED_DIM = 1024
PARAM_PREFIX = config.PARAMETER_STORE_PREFIX
KB_SSM_NAME = f"{PARAM_PREFIX}/waggleai/nutritionkbid"

sts = boto3.client("sts", region_name=REGION)
ACCOUNT = sts.get_caller_identity()["Account"]

SRC_BUCKET = f"waggle-ai-nutrition-kb-src-{ACCOUNT}"
VEC_BUCKET = f"waggle-ai-nutrition-vectors-{ACCOUNT}"
VEC_INDEX = "nutrition-index"
ROLE_NAME = "waggle-ai-nutrition-kb-role"
KB_NAME = "waggle-ai-nutrition-kb"
DS_NAME = "nutrition-docs"

VEC_BUCKET_ARN = f"arn:aws:s3vectors:{REGION}:{ACCOUNT}:bucket/{VEC_BUCKET}"
VEC_INDEX_ARN = f"{VEC_BUCKET_ARN}/index/{VEC_INDEX}"
EMBED_MODEL_ARN = f"arn:aws:bedrock:{REGION}::foundation-model/{EMBED_MODEL_ID}"

s3 = boto3.client("s3", region_name=REGION)
s3v = boto3.client("s3vectors", region_name=REGION)
iam = boto3.client("iam", region_name=REGION)
bedrock = boto3.client("bedrock-agent", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)


def log(msg: str) -> None:
    print(f"[setup_kb] {msg}")


def create_source_bucket() -> None:
    try:
        if REGION == "us-east-1":
            s3.create_bucket(Bucket=SRC_BUCKET)
        else:
            s3.create_bucket(
                Bucket=SRC_BUCKET,
                CreateBucketConfiguration={"LocationConstraint": REGION},
            )
        log(f"created source bucket {SRC_BUCKET}")
    except s3.exceptions.BucketAlreadyOwnedByYou:
        log(f"source bucket {SRC_BUCKET} already exists")

    knowledge = Path(__file__).parent / "knowledge"
    docs = sorted(knowledge.glob("*.md"))
    for doc in docs:
        s3.upload_file(str(doc), SRC_BUCKET, f"nutrition/{doc.name}")
    log(f"uploaded {len(docs)} docs to s3://{SRC_BUCKET}/nutrition/")


def create_vector_store() -> None:
    try:
        s3v.create_vector_bucket(vectorBucketName=VEC_BUCKET)
        log(f"created vector bucket {VEC_BUCKET}")
    except Exception as e:  # noqa: BLE001 - already-exists is fine
        log(f"vector bucket: {type(e).__name__} (assuming exists)")
    try:
        s3v.create_index(
            vectorBucketName=VEC_BUCKET,
            indexName=VEC_INDEX,
            dimension=EMBED_DIM,
            dataType="float32",
            distanceMetric="cosine",
        )
        log(f"created vector index {VEC_INDEX} (dim={EMBED_DIM}, cosine)")
    except Exception as e:  # noqa: BLE001
        log(f"vector index: {type(e).__name__} (assuming exists)")


def create_role() -> str:
    trust = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": "bedrock.amazonaws.com"},
                "Action": "sts:AssumeRole",
                "Condition": {"StringEquals": {"aws:SourceAccount": ACCOUNT}},
            },
        ],
    }
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "Embed",
                "Effect": "Allow",
                "Action": ["bedrock:InvokeModel"],
                "Resource": [EMBED_MODEL_ARN],
            },
            {
                "Sid": "Vectors",
                "Effect": "Allow",
                "Action": ["s3vectors:*"],
                "Resource": [VEC_BUCKET_ARN, VEC_INDEX_ARN],
            },
            {
                "Sid": "Source",
                "Effect": "Allow",
                "Action": ["s3:GetObject", "s3:ListBucket"],
                "Resource": [
                    f"arn:aws:s3:::{SRC_BUCKET}",
                    f"arn:aws:s3:::{SRC_BUCKET}/*",
                ],
            },
        ],
    }
    try:
        role = iam.create_role(
            RoleName=ROLE_NAME,
            AssumeRolePolicyDocument=json.dumps(trust),
        )
        arn = role["Role"]["Arn"]
        log(f"created role {ROLE_NAME}")
    except iam.exceptions.EntityAlreadyExistsException:
        arn = iam.get_role(RoleName=ROLE_NAME)["Role"]["Arn"]
        log(f"role {ROLE_NAME} already exists")
    iam.put_role_policy(
        RoleName=ROLE_NAME,
        PolicyName="kb-access",
        PolicyDocument=json.dumps(policy),
    )
    log("attached inline policy kb-access")
    return arn


def find_kb() -> str | None:
    for kb in bedrock.list_knowledge_bases(maxResults=100).get(
        "knowledgeBaseSummaries",
        [],
    ):
        if kb["name"] == KB_NAME:
            return kb["knowledgeBaseId"]
    return None


def create_kb(role_arn: str) -> str:
    existing = find_kb()
    if existing:
        log(f"knowledge base {KB_NAME} already exists: {existing}")
        return existing
    # Retry a few times while the new IAM role propagates.
    last = None
    for attempt in range(6):
        try:
            resp = bedrock.create_knowledge_base(
                name=KB_NAME,
                description="Pet nutrition guidance for the nutrition agent",
                roleArn=role_arn,
                knowledgeBaseConfiguration={
                    "type": "VECTOR",
                    "vectorKnowledgeBaseConfiguration": {
                        "embeddingModelArn": EMBED_MODEL_ARN,
                        "embeddingModelConfiguration": {
                            "bedrockEmbeddingModelConfiguration": {
                                "dimensions": EMBED_DIM,
                                "embeddingDataType": "FLOAT32",
                            },
                        },
                    },
                },
                storageConfiguration={
                    "type": "S3_VECTORS",
                    "s3VectorsConfiguration": {"indexArn": VEC_INDEX_ARN},
                },
            )
            kb_id = resp["knowledgeBase"]["knowledgeBaseId"]
            log(f"created knowledge base {kb_id}")
            return kb_id
        except Exception as e:  # noqa: BLE001 - usually role-propagation delay
            last = e
            log(
                f"create_kb attempt {attempt + 1} failed ({type(e).__name__}); retrying in 10s",
            )
            time.sleep(10)
    raise RuntimeError(f"could not create knowledge base: {last}")


def wait_kb_active(kb_id: str) -> None:
    while True:
        st = bedrock.get_knowledge_base(knowledgeBaseId=kb_id)["knowledgeBase"][
            "status"
        ]
        log(f"  kb status: {st}")
        if st == "ACTIVE":
            return
        if st == "FAILED":
            raise RuntimeError("knowledge base creation FAILED")
        time.sleep(5)


def find_data_source(kb_id: str) -> str | None:
    for ds in bedrock.list_data_sources(knowledgeBaseId=kb_id, maxResults=100).get(
        "dataSourceSummaries",
        [],
    ):
        if ds["name"] == DS_NAME:
            return ds["dataSourceId"]
    return None


def create_data_source(kb_id: str) -> str:
    existing = find_data_source(kb_id)
    if existing:
        log(f"data source {DS_NAME} already exists: {existing}")
        return existing
    resp = bedrock.create_data_source(
        knowledgeBaseId=kb_id,
        name=DS_NAME,
        dataSourceConfiguration={
            "type": "S3",
            "s3Configuration": {
                "bucketArn": f"arn:aws:s3:::{SRC_BUCKET}",
                "inclusionPrefixes": ["nutrition/"],
            },
        },
    )
    ds_id = resp["dataSource"]["dataSourceId"]
    log(f"created data source {ds_id}")
    return ds_id


def ingest(kb_id: str, ds_id: str) -> None:
    job = bedrock.start_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=ds_id)
    job_id = job["ingestionJob"]["ingestionJobId"]
    log(f"started ingestion job {job_id}; polling...")
    while True:
        status = bedrock.get_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=ds_id,
            ingestionJobId=job_id,
        )["ingestionJob"]["status"]
        log(f"  ingestion status: {status}")
        if status in ("COMPLETE", "FAILED"):
            break
        time.sleep(10)
    if status != "COMPLETE":
        raise RuntimeError(f"ingestion job ended in status {status}")


def main() -> None:
    log(f"account={ACCOUNT} region={REGION}")
    create_source_bucket()
    create_vector_store()
    role_arn = create_role()
    kb_id = create_kb(role_arn)
    wait_kb_active(kb_id)  # can't ingest while the KB is still CREATING
    ds_id = create_data_source(kb_id)
    ingest(kb_id, ds_id)
    ssm.put_parameter(Name=KB_SSM_NAME, Value=kb_id, Type="String", Overwrite=True)
    log(f"wrote KB id to SSM {KB_SSM_NAME}")
    print(f"\n✅ Nutrition KB ready. knowledgeBaseId = {kb_id}")
    print(
        f"   (also in SSM {KB_SSM_NAME}) — the nutrition agent will pick it up automatically.",
    )


if __name__ == "__main__":
    main()
