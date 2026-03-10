# Cleanup Script

Identifies and safely deletes AWS resources that remain after CloudFormation stacks are destroyed. Targets resources tagged with workshop tags.

!!! danger "Destructive Operations"
    This script performs destructive operations that cannot be undone. Always run with `--dry-run` first.

## Resources Cleaned Up

| Resource Type | Special Handling |
|---------------|------------------|
| CloudWatch Log Groups | Pattern matching for untagged groups |
| EBS Volumes | Unattached volumes only |
| EBS Snapshots | User-owned snapshots only |
| RDS Backups | Manual snapshots only (automatic backups untouched) |
| ECS Task Definitions | Deregistered, not deleted |
| S3 Buckets | All objects and versions deleted first |

## Usage

```bash
cd src/cdk

# 1. Discover all workshop stack names
npm run cleanup -- --discover

# 2. Preview what would be deleted
npm run cleanup -- --stack-name MyWorkshopStack --dry-run

# 3. Perform the cleanup
npm run cleanup -- --stack-name MyWorkshopStack

# 4. Clean up in a specific region
npm run cleanup -- --stack-name MyWorkshopStack --region us-west-2
```

## Options

| Option | Description |
|--------|-------------|
| `--stack-name <name>` | Stack name to clean up |
| `--discover` | List all found stack names |
| `--dry-run` | Preview without deleting |
| `--region <region>` | AWS region |
| `--cleanup-missing-tags` | Clean resources without stackName tags |
| `--skip-confirmation` | Skip confirmation prompts |

## Recommended Workflow

```bash
# Step 1: Primary CDK cleanup
cdk destroy --all

# Step 2: Discover remaining resources
npm run cleanup -- --discover

# Step 3: Preview
npm run cleanup -- --stack-name MyStack --dry-run

# Step 4: Review output carefully, then clean
npm run cleanup -- --stack-name MyStack
```

## Safety Features

- Only deletes unattached EBS volumes
- Only touches manual RDS snapshots
- Handles versioned S3 objects and delete markers
- Continues processing if individual resources fail
- Tag verification before deletion
- User confirmation prompts
