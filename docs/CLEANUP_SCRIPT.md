# AWS Resource Cleanup Script for One Observability Workshop

This script identifies and safely deletes AWS resources that may remain after CloudFormation stacks are destroyed. It targets resources tagged with specific workshop tags and provides multiple safety mechanisms to prevent accidental deletions.

## 🚨 Important Safety Notice

**This script performs destructive operations that cannot be undone!**

- Always run with `--dry-run` first to see what would be deleted
- Only run against resources you own and are certain you want to delete
- Ensure you have proper AWS credentials and permissions
- Test in a non-production environment first
- Keep backups of any important data before running

## 📋 Prerequisites

1. **Node.js and npm** installed
2. **AWS CLI configured** with appropriate credentials
3. **AWS permissions** for the following services:
   - CloudWatch Logs (logs:DescribeLogGroups, logs:DeleteLogGroup)
   - EC2 (ec2:DescribeVolumes, ec2:DeleteVolume, ec2:DescribeSnapshots, ec2:DeleteSnapshot)
   - RDS (rds:DescribeDB*Snapshots, rds:DeleteDB*Snapshot)
   - ECS (ecs:ListTaskDefinitions, ecs:DescribeTaskDefinition, ecs:DeregisterTaskDefinition)
   - S3 (s3:ListBuckets, s3:GetBucketTagging, s3:ListObjectVersions, s3:DeleteObject, s3:DeleteBucket)
   - Resource Groups Tagging API (resourcegroupstaggingapi:GetResources)

## 🏷️ Resource Identification

The script identifies workshop resources using these tags:
```javascript
{
  environment: 'non-prod',
  application: 'One Observability Workshop',
  stackName: '<your-stack-name>'
}
```

## 🧹 Resources Cleaned Up

| Resource Type | Description | Special Handling |
|---------------|-------------|------------------|
| **CloudWatch Log Groups** | Log groups with workshop tags | Pattern matching for untagged groups |
| **EBS Volumes** | Unattached volumes only | Attached volumes are skipped for safety |
| **EBS Snapshots** | User-owned snapshots | Only your account's snapshots |
| **RDS Backups** | Manual DB and cluster snapshots | Automatic backups are not touched |
| **ECS Task Definitions** | Active task definitions | Deregistered, not deleted |
| **S3 Buckets** | Workshop-tagged buckets | **All objects and versions deleted first** |

## 🚀 Installation and Setup

1. Navigate to the CDK directory:
```bash
cd src/cdk
```

2. Install dependencies (if not already done):
```bash
npm install
```

3. Verify the script is available:
```bash
npm run cleanup -- --help
```

## 📖 Usage

### Basic Usage Patterns

```bash
# 1. Discover all workshop stack names
npm run cleanup -- --discover

# 2. Preview what would be deleted (RECOMMENDED FIRST STEP)
npm run cleanup -- --stack-name MyWorkshopStack --dry-run

# 3. Actually perform the cleanup
npm run cleanup -- --stack-name MyWorkshopStack

# 4. Clean up in a specific region
npm run cleanup -- --stack-name MyWorkshopStack --region us-west-2
```

### Command Line Options

| Option | Description | Required | Example |
|--------|-------------|----------|---------|
| `--stack-name <name>` | Specific stack name to clean up | Yes* | `--stack-name MyWorkshopStack` |
| `--discover` | List all found stack names | No | `--discover` |
| `--dry-run` | Preview without deleting | No | `--dry-run` |
| `--region <region>` | AWS region | No | `--region us-west-2` |
| `--cleanup-missing-tags` | Clean up resources without stackName tags | No | `--cleanup-missing-tags` |
| `--skip-confirmation` | Skip confirmation prompts | No | `--skip-confirmation` |
| `--help` | Show help message | No | `--help` |

*Required unless using `--discover` or `--cleanup-missing-tags`

## 🔍 Discovery Mode

Use discovery mode to find all workshop stack names in your AWS account:

```bash
npm run cleanup -- --discover
```

**Example output:**
```
🔍 Discovering stack names from existing resources...

Found the following workshop stack names:
   • MyWorkshopStack-2024-01
   • TestWorkshopStack
   • DemoWorkshopStack-v2

To clean up a specific stack, run:
npm run cleanup -- --stack-name <STACK_NAME> --dry-run
```

## 🧪 Dry Run Mode (Highly Recommended)

**Always run in dry-run mode first** to see what would be deleted:

```bash
npm run cleanup -- --stack-name MyWorkshopStack --dry-run
```

**Example output:**
```
🧹 [DRY RUN] Cleaning up resources for stack: MyWorkshopStack

🗂️  Cleaning up CloudWatch Log Groups...
   [DRY RUN] Would delete log group: /aws/lambda/MyWorkshopStack-function

💾 Cleaning up EBS Volumes...
   [DRY RUN] Would delete EBS volume: vol-1234567890abcdef0

🪣 Cleaning up S3 Buckets...
   [DRY RUN] Would empty and delete S3 bucket: myworkshopstack-artifacts-bucket

📊 [DRY RUN] Cleanup Summary:
   CloudWatch Log Groups: 1
   EBS Volumes: 1
   S3 Buckets: 1
   Total Resources: 3

⚠️  This was a dry run. To actually delete these resources, run without --dry-run
```

## 🏷️ Handling Resources with Missing Tags

### Problem
Older workshop deployments may lack the `stackName` tag, making them impossible to identify by stack name alone.

### Detection and Cleanup
```bash
# Check for resources with missing stackName tags
npm run cleanup -- --cleanup-missing-tags --dry-run

# Actually clean up resources without stackName tags
npm run cleanup -- --cleanup-missing-tags
```

The script uses a fallback approach:
1. **First**: Resources with `environment` + `application` tags (but missing valid `stackName`)
2. **Fallback**: Resources with only `application` tag (broader scope)

## 💡 Workflow Examples

### Standard Workshop Cleanup
```bash
# Step 1: Discover stacks
npm run cleanup -- --discover

# Step 2: Preview cleanup for your stack
npm run cleanup -- --stack-name MyWorkshopStack-2024-01 --dry-run

# Step 3: Review the output carefully

# Step 4: Perform actual cleanup
npm run cleanup -- --stack-name MyWorkshopStack-2024-01
```

### Multi-Region Cleanup
```bash
# Clean up in multiple regions
npm run cleanup -- --stack-name MyWorkshopStack --region us-east-1 --dry-run
npm run cleanup -- --stack-name MyWorkshopStack --region us-west-2 --dry-run

# If resources found, clean them up
npm run cleanup -- --stack-name MyWorkshopStack --region us-east-1
npm run cleanup -- --stack-name MyWorkshopStack --region us-west-2
```

## 🛡️ Safety Features

### Built-in Safety Mechanisms
- **EBS Volumes**: Only deletes unattached volumes
- **RDS Backups**: Only touches manual snapshots, not automated backups
- **S3 Buckets**: Handles versioned objects and delete markers properly
- **Error Handling**: Continues processing other resources if one fails
- **Tag Verification**: Double-checks tags before deletion
- **Dry-run Mode**: Safe preview of all operations
- **User Confirmation**: Prompts for confirmation before destructive operations

### What the Script Will NOT Delete
- Attached EBS volumes
- Automated RDS backups
- Resources without proper workshop tags
- Resources from other AWS accounts
- Resources in use by running applications

## 📊 Understanding Output

### Success Messages
- `✅ Deleted <resource-type>: <resource-id>` - Resource successfully deleted
- `🗂️ Emptying S3 bucket: <bucket-name>` - S3 bucket being emptied
- `Deleted X objects` - Objects removed from S3 bucket

### Error Messages
- `❌ Failed to delete <resource>: <error>` - Specific resource deletion failed
- `❌ Error cleaning up <service>: <error>` - Service-level error occurred

### Summary Report
```
📊 Cleanup Summary:
   CloudWatch Log Groups: 2
   EBS Volumes: 1
   EBS Snapshots: 0
   RDS Backups: 0
   ECS Task Definitions: 3
   S3 Buckets: 1
   Total Resources: 7

✅ Successfully cleaned up 7 resources!
```

## 🔧 Troubleshooting

### Common Issues and Solutions

#### Permission Denied Errors
**Problem**: `AccessDenied` or `UnauthorizedOperation` errors
**Solution**:
- Verify AWS credentials: `aws sts get-caller-identity`
- Check IAM permissions for required services
- Ensure you have permission to delete specific resource types

#### Resource Not Found
**Problem**: Resources show in dry-run but fail during deletion
**Solution**:
- Resource may have been deleted by another process
- Check if resource still exists in AWS console
- Re-run discovery to see current state

#### S3 Bucket Deletion Fails
**Problem**: Bucket deletion fails with `BucketNotEmpty`
**Solution**:
- Script should handle this automatically
- Manually check bucket in console for remaining objects
- Verify bucket versioning and delete markers

### Debug Steps

1. **Verify AWS Configuration**:
   ```bash
   aws sts get-caller-identity
   aws configure list
   ```

2. **Check Resource Existence**:
   ```bash
   # List resources manually
   aws ec2 describe-volumes --filters Name=tag:stackName,Values=MyWorkshopStack
   aws logs describe-log-groups
   aws s3 ls
   ```

3. **Test Permissions**:
   ```bash
   # Test basic permissions
   aws ec2 describe-volumes
   aws s3 list-buckets
   aws logs describe-log-groups
   ```

## 🏗️ Technical Details

### Architecture
- **Language**: TypeScript with Node.js
- **AWS SDK**: AWS SDK v3 for JavaScript
- **Execution**: Uses ts-node for direct TypeScript execution
- **Parallelization**: Cleans up different resource types in parallel
- **Error Handling**: Graceful degradation with detailed error reporting

### S3 Bucket Special Handling
S3 buckets cannot be deleted if they contain objects. The script automatically:
1. Lists all object versions (including delete markers)
2. Deletes objects in batches of 1000
3. Handles versioned objects and delete markers
4. Processes all pages until bucket is completely empty
5. Only then attempts bucket deletion

## 🔐 Security Considerations

### Required IAM Permissions
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:DescribeLogGroups",
                "logs:DeleteLogGroup",
                "ec2:DescribeVolumes",
                "ec2:DeleteVolume",
                "ec2:DescribeSnapshots",
                "ec2:DeleteSnapshot",
                "rds:DescribeDBSnapshots",
                "rds:DeleteDBSnapshot",
                "rds:DescribeDBClusterSnapshots",
                "rds:DeleteDBClusterSnapshot",
                "ecs:ListTaskDefinitions",
                "ecs:DescribeTaskDefinition",
                "ecs:DeregisterTaskDefinition",
                "s3:ListBucket",
                "s3:GetBucketTagging",
                "s3:ListObjectVersions",
                "s3:DeleteObject",
                "s3:DeleteBucket",
                "resource-groups:GetResources"
            ],
            "Resource": "*"
        }
    ]
}
```

### Security Features
- **Tag-based filtering**: Only affects resources with workshop tags
- **Dry-run default**: Encourages preview before deletion
- **Confirmation prompts**: Prevents accidental deletions
- **Scope limitations**: Focuses on specific resource types only
- **Audit trail**: All operations logged to CloudTrail

## 🤝 Integration with CDK

### Typical Cleanup Workflow
```bash
# Primary cleanup
cdk destroy --all

# Find remaining resources
npm run cleanup -- --discover

# Clean specific leftovers
npm run cleanup -- --stack-name MyStack --dry-run
npm run cleanup -- --stack-name MyStack
```

### When to Use
- **After stack deletion**: When `cdk destroy` leaves resources behind
- **Bulk cleanup**: Cleaning up multiple old workshop instances
- **Edge case handling**: Resources with missing or incorrect tags
- **Cost management**: Removing forgotten resources that incur charges

## 📚 Related Documentation

- [AWS Resource Groups Tagging API](https://docs.aws.amazon.com/resourcegroupstaggingapi/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/)
- [One Observability Workshop](../README.md)

---

**Remember**: This is a destructive operation. Always test with `--dry-run` first and ensure you have backups of any important data.