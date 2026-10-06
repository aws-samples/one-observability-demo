<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# ADR-0001: Deployment template split and safer teardown

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** One Observability Demo maintainers

## Context

The workshop is bootstrapped by a single CloudFormation template,
`src/templates/codebuild-deployment-template.yaml`. That template does not
create the application infrastructure itself: it provisions an S3 config bucket,
an SSM parameter, and a CodeBuild project, then the CodeBuild `build` phase runs
`cdk deploy OneObservability`, which deploys a **self-mutating CDK CodePipeline**
(`src/cdk/lib/pipeline.ts`). That pipeline, not CloudFormation, creates every
real resource across its waves (Core, Containers, Storage, Compute,
Microservices), plus the custom `CDKToolkitPetsite` bootstrap stack, the
`cdk-petsite-assets-*` bucket, and the `cdk-petsite-container-assets-*` ECR
repository.

Three problems follow from this design:

1. **CloudFormation cannot delete what it did not create.** The CDK-pipeline
   stacks, the bootstrap stack, the assets bucket, and the ECR repo are orphans
   from the bootstrapper's point of view. Deleting the bootstrap stack leaves all
   of it behind, still costing money and blocking a clean relaunch. The template
   answered this with an embedded Step Function (`<stack>-cdk-cleanup`) that
   discovers those stacks by the `application` tag, deletes them in reverse
   `sequence` order, then removes the bootstrap stack, bucket, and ECR repo.

2. **Destructive teardown was coupled to an ambiguous failure signal.** The same
   Step Function was triggered automatically from three paths: the CodeBuild
   `post_build` failure branch, the `rCleanupMonitor` custom-resource Delete
   handler (stack rollback/delete), and an EventBridge rule on
   `DELETE_IN_PROGRESS`. Deployment is coordinated by two timers: the pipeline
   signaller in `scripts/wait-for-pipeline.sh` (5100s) and the CloudFormation
   `WaitCondition` (7200s). If the wait condition expires first, CloudFormation
   rolls back and the cleanup machine runs, **destroying a healthy-but-slow
   deployment**. This failure mode was recorded in the 2026-09-14 RCA; guards
   were added since (honoring `pDisableCleanup` on the Delete path, widening the
   wait-condition headroom), but the fundamental coupling of "timed out watching"
   to "destroy everything" remained.

3. **The template is near the inline size limit.** The combined template is
   ~75 KB, over CloudFormation's 51,200-byte `--template-body` limit, so it must
   be uploaded to S3 and deployed with `--template-url`. The embedded Step
   Function and its retained Lambdas, roles, and EventBridge wiring are the bulk
   of that size and of the IAM surface.

## Decision

Split the single template into three, and make teardown explicit and
non-destructive by default.

1. **`codebuild-deployment-lite.yaml` (new, lite).** Deploy only: config bucket,
   SSM parameter, CodeBuild project, start-deployment Lambda. No Step Function,
   no cleanup Lambdas, no auto-rollback of the CDK deploy. On build failure it
   reports failure and leaves the CDK application stacks in place for inspection
   and retry. Teardown is manual, via the existing
   `npm run cleanup -- --discover` script (`src/cdk/scripts/cleanup-resources.ts`).
   Small enough to deploy inline.

2. **`codebuild-deployment-template.yaml` (main, hardened).** Keeps the
   deploy-and-wait behavior but removes every automatic path into destructive
   teardown: the `post_build` cleanup branch, the `rCleanupMonitor` Delete-path
   invocation, and the `rStackDeletionRule` EventBridge rule. The cleanup state
   machine is no longer embedded; the template references the standalone teardown
   stack instead. A deploy timeout marks the bootstrap stack failed and leaves
   the workload intact.

3. **`teardown-stepfunction.yaml` (new, standalone).** The cleanup state machine
   and its Lambdas/roles as their own stack, deployed deliberately when an
   operator wants managed teardown. It survives a failed deploy (which is exactly
   when it is needed), requires an explicit confirmation input, supports a
   dry-run that logs the blast radius without deleting, and narrows stack
   matching to the `application` **and** `parent` tags so concurrent workshops in
   one account cannot delete each other's stacks.

The ordered, `sequence`-aware deletion logic, versioned-bucket emptying, and
self-deleting helper functions from the original Step Function are preserved;
only the trigger policy and packaging change.

## Consequences

### Positive

- A healthy-but-slow deploy is never torn down: no automatic path leads from a
  timeout or a stack rollback to deletion.
- The lite and main templates are both small enough to deploy inline, removing
  the mandatory S3 upload step for them.
- Teardown is explicit, auditable, and dry-runnable, with a blast radius scoped
  by two tags instead of one.
- The destructive machinery lives in its own stack, so it can be deployed, run,
  and removed independently of the deploy path, and it outlives a failed deploy.

### Negative / trade-offs

- Deleting the lite (or hardened main) bootstrap stack now leaves the CDK
  application stacks, the `petsite` bootstrap, the assets bucket, and the ECR repo
  orphaned until the operator runs `npm run cleanup` or deploys and runs the
  standalone teardown stack. This is the explicit cost of removing automatic
  teardown, and is the correct trade for dev, iteration, and managed-account use.
- There are now three templates to keep consistent. The shared buildspec and the
  cross-references in this ADR and the deployment docs are the mitigation.

## Affected artifacts

- `src/templates/codebuild-deployment-lite.yaml` (new)
- `src/templates/teardown-stepfunction.yaml` (new)
- `src/templates/codebuild-deployment-template.yaml` (hardened)
- `src/templates/README.md`, `README.md`, `CONTRIBUTING.md`,
  `docs-site/docs/deployment/**`
