# AGENTS.md — One Observability Demo

Orientation map for AI agents. Optimized for fast productivity, not exhaustiveness. Verify against cited files before making claims.

## 1. Purpose

Sample "pet adoption" application powering the [AWS One Observability Workshop](https://observability.workshop.aws/). It is a polyglot microservices app (6 services in 6 languages) plus supporting Lambdas, deployed entirely by an AWS CDK **self-mutating pipeline**. The point is to demonstrate AWS observability (CloudWatch, Application Signals, X-Ray, ADOT/OpenTelemetry, OpenSearch). Docs are published at https://aws-samples.github.io/one-observability-demo/.

## 2. TL;DR for agents

- Everything lives under `src/`. Two halves: **infrastructure** (`src/cdk/`, TypeScript CDK) and **application code** (`src/applications/`, polyglot).
- The CDK app is the control plane. Two entry points: `src/cdk/bin/workshop.ts` (production pipeline) and `src/cdk/bin/local.ts` (direct stack deploy for local dev). `cdk.json` runs `bin/workshop.js`.
- Deployment model: a CDK **CodePipeline** deploys 5 stages — Core, Containers, Storage, Compute, Microservices (see `src/cdk/lib/pipeline.ts` and `lib/stages/`).
- 6 microservices in `src/applications/microservices/`: Go, Rust, Java, Python, .NET, Python-Strands-agent. Each has its own Dockerfile and build toolchain.
- Config is driven by env vars resolved in `src/cdk/bin/environment.ts` + `constants.ts`; presets in `src/presets/*.env`; local dev uses `src/cdk/.env` (copy from `.env.sample`).
- CI: GitHub Actions in `.github/workflows/` (build-test, tests, security-scan/ASH, pre-commit, docs, release). Pre-commit hooks are heavy (secrets, lint, jest, ASH) — see `.pre-commit-config.yaml`.
- Commits must follow **Conventional Commits** (commitizen enforced on commit-msg).
- `archive/` is a scratch/temp folder slated for removal — do not treat as authoritative. `buildspec.yml` references an obsolete `PetAdoptions/cdk/pet_stack/` path (stale; real build is CDK pipeline).
- Only touch code inside its component directory; the repo root `package.json` is just tooling (eslint/typedoc), not the app.

## 3. Repository map

| Path | Purpose | Entry points / key files |
|------|---------|--------------------------|
| `src/cdk/` | CDK app (TypeScript) — all infra | `bin/workshop.ts`, `bin/local.ts`, `bin/environment.ts`, `cdk.json`, `index.ts` |
| `src/cdk/lib/pipeline.ts` | Self-mutating CDK CodePipeline definition | `CDKPipeline` class |
| `src/cdk/lib/stages/` | The 5 deployment stages (Stack + Stage per file) | `core.ts`, `containers.ts`, `storage.ts`, `compute.ts`, `applications.ts` |
| `src/cdk/lib/constructs/` | Reusable L3 constructs (vpc, eks, ecs, database, waf, opensearch, lambda, canary…) | `index.ts` re-exports |
| `src/cdk/lib/microservices/` | Per-service CDK wiring + EKS `manifests/` | `petsite.ts`, `pet-search.ts`, `petfood.ts`, … |
| `src/cdk/lib/serverless/` | Lambda + canary CDK definitions | `functions/`, `canaries/` |
| `src/cdk/scripts/` | Ops scripts (deploy-check, seed, redeploy, cleanup, validate-account) | `deploy-check.sh`, `seed-dynamodb.sh`, `redeploy-app.sh` |
| `src/applications/microservices/` | The 6 runtime services (polyglot) | one dir per service (see §7) |
| `src/applications/lambda/` | 9 Lambda functions (Node/Python) | e.g. `petstatusupdater-node`, `rds-seeder-python` |
| `src/applications/canaries/` | CloudWatch Synthetics canaries (Node) | `petsite-canary`, `housekeeping` |
| `src/templates/` | CloudFormation bootstrap template for the workshop | `codebuild-deployment-template.yaml` |
| `src/presets/` | Env presets consumed by CDK config | `default.env`, `hardened.env`, `workshop.env` |
| `src/scripts/` | Pet image generation (Python) | `realistic_*.py` |
| `docs-site/` | MkDocs site (published docs) | `mkdocs.yml`, `docs/` |
| `static/images/` | Pet image assets seeded to S3 | bunnies/kittens/puppies |
| `generated-diagrams/` | Architecture diagram images | — |
| `archive/` | Temp scratch (gitops, grafana, keycloak) — slated for removal | `README.md` says so |
| `.github/workflows/` | CI | see §5 |

## 4. Tech stack

- **Infra:** AWS CDK v2 (`aws-cdk-lib` 2.241, TypeScript ~5.9), cdk-nag, CodePipeline/CodeBuild. Node 22.
- **Microservices:** Go (`payforadoption-go`), Rust/Axum (`petfood-rs`), Java/Spring Boot + Gradle (`petsearch-java`), Python/FastAPI (`petlistadoptions-py`), .NET 8 (`petsite-net`), Python/Strands agent on Bedrock AgentCore (`petfoodagent-strands-py`).
- **Runtimes/platforms:** ECS Fargate (most services), EKS (petsite), Bedrock AgentCore (agent), Lambda (Node 22 / Python 3.13).
- **Data:** Aurora PostgreSQL, DynamoDB, S3, SQS, EventBridge, OpenSearch Serverless.
- **Observability:** CloudWatch, Application Signals, X-Ray, ADOT/OpenTelemetry, Prometheus, CloudWatch Synthetics, RUM.
- **Docs:** MkDocs (Material) + TypeDoc for CDK API reference.

## 5. Build / test / run / deploy

**CDK infra** (from `src/cdk/`, per `src/cdk/package.json` + `.github/workflows/tests.yml`):
- Build: `npm run build` (tsc). Type check: `npx tsc --noEmit`.
- Test: `npm run test` (jest). List stacks: `npx cdk ls`. Synth: `npx cdk synth`.
- Docs: `npm run docs` (typedoc). Cleanup: `npm run cleanup -- --discover`.

**Local deploy** (from `src/cdk/`, per `CONTRIBUTING.md` + `docs-site/docs/deployment/quick-start.md`):
```bash
cp .env.sample .env          # edit AWS account/region/branch
./scripts/deploy-check.sh    # MUST run first; validates + preps S3 source
cdk -a "npx ts-node bin/local.ts" list
cdk -a "npx ts-node bin/local.ts" deploy --all
```

**Full workshop deploy** (production model) — CloudFormation launches the CodeBuild-driven CDK pipeline:
```bash
aws cloudformation create-stack \
  --stack-name OneObservability-Workshop-CDK \
  --template-body file://src/templates/codebuild-deployment-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters ParameterKey=pOrganizationName,ParameterValue=aws-samples \
    ParameterKey=pRepositoryName,ParameterValue=one-observability-demo \
    ParameterKey=pBranchName,ParameterValue=main \
    ParameterKey=pWorkingFolder,ParameterValue=src/cdk
```

**Per-service build/test** (from `.github/workflows/build-test.yml` and `tests.yml`):
- Docker services: `docker build` each service dir (Go/Rust/Java/Python/.NET).
- Rust: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test --lib --bins`, `cargo build --release`.
- Node lambdas: `npm ci && npm test && npm run build --if-present` (Node 22).
- Python lambdas: `pip install -r requirements.txt && pytest` (Python 3.13).
- .NET: `dotnet restore && dotnet build` against `petsite.sln`.

**Redeploy a single service after infra exists:** `src/cdk/scripts/redeploy-app.sh` (prompts for service, platform, ECS target).

## 6. Architecture & main flows

Deployment (CDK pipeline, see `docs-site/docs/architecture/overview.md`):
```
Source -> Synth -> [Core Wave: Core + Containers] -> [Backend Wave: Storage + Compute] -> Microservices
```
- **Core:** VPC, subnets, VPC endpoints, security groups, CloudTrail, EventBridge, OpenSearch.
- **Containers:** parallel ECR image builds for all 6 services via an inner CodePipeline.
- **Storage:** DynamoDB, Aurora PostgreSQL, S3, SQS + post-deploy DynamoDB/RDS seeding.
- **Compute:** ECS cluster, EKS cluster, load balancers.
- **Microservices:** service deploys, Lambdas, canaries, WAF associations.

Runtime service map (see `docs-site/docs/microservices/index.md`):
```
User -> petsite-net (.NET/EKS)
          -> petsearch-java (ECS)      -> DynamoDB
          -> petlistadoptions-py (ECS) -> Aurora
          -> payforadoption-go (ECS)   -> Aurora + DynamoDB
          -> petfood-rs (Rust/ECS)     -> DynamoDB
                -> petfoodagent-strands-py (AgentCore)
                -> EventBridge -> Stock Processor Lambda / Image Generator Lambda
```
Cross-stack wiring uses CloudFormation exports and SSM parameters — names centralized in `src/cdk/bin/constants.ts` (`SSM_PARAMETER_NAMES` and `*_EXPORT_NAME`).

## 7. Key directories in depth

- **`src/cdk/bin/`** — `workshop.ts` (pipeline entry, instantiates `CDKPipeline`), `local.ts` (builds each Stack directly for dev), `environment.ts` (resolves all config from env/context), `constants.ts` (export names, SSM keys, enums like `ContainerArchitecture`, `CloudWatchAgentTraceMode`).
- **`src/cdk/lib/stages/`** — each file exports both a `*Stage` (pipeline stage) and a `*Stack` (used by `local.ts`). `containers.ts` also defines the ECR build action and `ContainerDefinition` used to describe each service.
- **`src/cdk/lib/microservices/`** — glue between stages and service source; `manifests/` holds EKS YAML for petsite.
- **`src/applications/microservices/<svc>/`** — each has a `Dockerfile` + `README.md`. Notable: `petfood-rs/API_DOCUMENTATION.md`, `petsearch-java/manual-instrumentation-complete/`, `petsite-net/petsite.sln`, `petfoodagent-strands-py/agent.py`.
- **`src/applications/lambda/`** — feature Lambdas: image generation, stock/cleanup processors, status updater, RDS seeder, traffic generator, user creator, pipeline-retry, capacity test.
- **`docs-site/docs/`** — authoritative human docs: `architecture/`, `deployment/`, `operations/`, `microservices/`. Prefer these over `archive/`.

## 8. Conventions & guardrails

- **Commits:** Conventional Commits enforced by commitizen (`.pre-commit-config.yaml`, commit-msg hook).
- **Style:** Prettier + ESLint (flat config `eslint.config.mjs`, `.prettierrc.json`) for TS/JS; Black + flake8 (`.flake8`) + mypy + pyupgrade for Python; `cargo fmt`/clippy for Rust.
- **Security gates:** detect-secrets (baseline `.secrets.baseline`), detect-aws-credentials, detect-private-key, python-safety, ASH (`.ash/`, `awslabs/automated-security-helper`), Snyk. Secrets in code must be annotated `#pragma: allowlist secret` (see `constants.ts`).
- **CDK compliance:** cdk-nag `AwsSolutionsChecks` + custom `WorkshopNagPack` run on synth (applied in `bin/workshop.ts`/`local.ts`); suppressions are explicit via `NagSuppressions`.
- **CI must pass:** build-test (per-language), tests (cdk synth + rust), security-scan, pre-commit.
- **Inclusive language:** avoid master/slave/whitelist/blacklist; note `CONTRIBUTING.md` still says "master branch" but the default branch is `main`.

## 9. Gotchas & non-obvious knowledge

- `buildspec.yml` points at `PetAdoptions/cdk/pet_stack/` — that path no longer exists; it is stale. The live deploy is the CDK pipeline via `src/templates/codebuild-deployment-template.yaml`. Do not trust `buildspec.yml`.
- `archive/` is explicitly temporary (`archive/README.md`: "will be removed before release"). Excluded from most lint/secret hooks.
- `deploy-check.sh` MUST run before `bin/local.ts` deploys — it prepares the S3 source zip the pipeline/stacks read.
- Two source modes: **CodeConnection** (GitHub, `CODE_CONNECTION_ARN`) or **S3 bucket** (`CONFIG_BUCKET`). Code branches on which is set (`bin/local.ts`, `pipeline.ts`).
- WAF/CloudFront-logs constructs require a us-east-1 GlobalStack when deploying to other regions (handled in `bin/local.ts`).
- Config precedence: CDK context first, then env vars (`bin/environment.ts`). Presets (`src/presets/*.env`) can be pulled via `CONFIG_FILE_URL`.
- EKS access: add your role via `EKS_CLUSTER_ACCESS_ROLE_NAME`; access pods with `k9s` after `aws eks update-kubeconfig --name PetsiteEKS-cluster` (CONTRIBUTING.md).
- CDK bootstrap uses a custom qualifier `petsite` / stack `CDKToolkitPetsite` in troubleshooting flows.
- Node canaries store their code under `nodejs/node_modules/index.js` (unusual layout required by CloudWatch Synthetics).
- Repo-root `package.json` (name `one-observability-workshop`) is tooling only; the deployable CDK app is `src/cdk/package.json` (name `cdk`).
- `.omni/`, `.kiro/`, `.claude/` are agent/tooling config, not app code.

## 10. Where to look for X

| Task | Go to |
|------|-------|
| Add/modify infra resource | `src/cdk/lib/constructs/` + the relevant `lib/stages/*.ts` |
| Change deployment ordering/pipeline | `src/cdk/lib/pipeline.ts`, `lib/stages/index.ts` |
| Add a config flag / env var | `src/cdk/bin/environment.ts` + `constants.ts`, presets in `src/presets/` |
| Change cross-stack names / SSM keys | `src/cdk/bin/constants.ts` |
| Edit a microservice's code | `src/applications/microservices/<svc>/` |
| Wire a microservice into infra | `src/cdk/lib/microservices/<svc>.ts` (+ `manifests/` for EKS) |
| Add/edit a Lambda | `src/applications/lambda/<fn>/` + `src/cdk/lib/serverless/functions/` |
| Add a canary | `src/applications/canaries/` + `src/cdk/lib/serverless/canaries/` |
| Seed data | `src/cdk/scripts/seed-dynamodb.sh`, `seed.json`, `petfood-seed.json`, RDS seeder Lambda |
| Redeploy one service locally | `src/cdk/scripts/redeploy-app.sh` |
| Update human docs | `docs-site/docs/**` (MkDocs) |
| Update CI | `.github/workflows/*` |
| Cleanup resources | `src/cdk/scripts/cleanup-resources.ts` (`npm run cleanup`), docs `operations/cleanup.md` |
| Local port-forward to ECS | `src/cdk/scripts/ecs-port-forward.sh` |

## 11. Production deployment gotchas

These were discovered during actual deployment and are not obvious from reading the code alone:

- **CloudFormation template exceeds inline limit.** The `codebuild-deployment-template.yaml` is ~75KB, exceeding CloudFormation's 51,200-byte `--template-body` limit. You must upload it to S3 first and use `--template-url` instead.
- **CDK bootstrap qualifier conflict.** The bootstrap script (`scripts/bootstrap-account.sh`) creates a stack named `CDKToolkitPetsite` with qualifier `petsite`. If the account was previously bootstrapped with qualifier `petsite` under a different stack name (e.g., the default `CDKToolkit`), the deploy fails with: `Export with name CdkBootstrap-petsite-FileAssetKeyArn is already exported by stack CDKToolkit`. **Fix:** delete the conflicting bootstrap stack and its resources before deploying:
  - IAM roles: `cdk-petsite-*-<account>-<region>` (5 roles — cfn-exec, deploy, file-publishing, image-publishing, lookup)
  - S3 bucket: `cdk-petsite-assets-<account>-<region>` (versioned — must delete all object versions)
  - SSM parameter: `/cdk-bootstrap/petsite/version`
  - ECR repository: `cdk-petsite-container-assets-<account>-<region>`
- **Tag parameters 4 and 5 are required by the CLI.** The `pUserDefinedTagKey4/5` and `pUserDefinedTagValue4/5` parameters have no `Default:` value in the template. When deploying via CLI, you must explicitly pass them (even as empty strings): `'ParameterKey=pUserDefinedTagKey4,ParameterValue='`.
- **Actual pipeline stages differ from §6.** The live pipeline has **7 stages** (not the 5 described in the architecture): `Source → Build → UpdatePipeline → Assets → Core → Backend → Microservices`. The "Containers" stage is embedded in `Assets`, and Storage+Compute are merged into `Backend`.
- **Stack deletion fails on `rCleanupMonitor`.** If the deployment fails before any CDK application stacks are created, deleting the main CloudFormation stack fails because `rCleanupMonitor` (a custom resource) tries to run a Step Function that deletes non-existent CDK stacks. **Fix:** `aws cloudformation delete-stack --retain-resources rCleanupMonitor --stack-name <stack>`.
- **Full deployment timing.** Production deploy (CloudFormation → CodeBuild → CDK Pipeline) takes ~40–50 minutes total: ~2 min for CFN resources, ~5 min for CodeBuild pre_build (clone + bootstrap), ~5 min for CDK synth+deploy of the pipeline stack, ~30 min for the pipeline stages (Core, Backend, Microservices).
- **Application URL is CloudFront, not ALB.** The PetSite is served via CloudFront (not directly via ALB). The URL is in stack output `oPetSiteUrl` and CloudFormation export `public:WorkshopPetSiteUrl`. It redirects to `/?userId=<random>` for traffic tracking/RUM.

## Maintenance

Regenerate this file by re-running the Repo Cartographer agent when the repo structure, stages, or service list changes. Cross-check claims against the cited files (paths above) since code evolves. Generated on **2026-08-10**.
