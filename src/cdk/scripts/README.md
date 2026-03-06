# CDK Exports Dashboard Generator

A comprehensive solution for extracting, organizing, and displaying CDK stack exports in a professional, searchable web dashboard.

## Overview

This tool addresses the challenge of CDK generating dynamic resource names by providing a user-friendly dashboard to view all stack exports with:

- **Multi-region support**: Automatically detects and aggregates exports from primary region + us-east-1 (when WAF is enabled)
- **Professional AWS-branded interface**: Clean, responsive design with official AWS styling
- **Advanced search**: Real-time search across export names, descriptions, stack names, and values
- **Smart categorization**: Automatic grouping by resource type (Networking, Database, Storage, etc.)
- **Easy navigation**: Copy-to-clipboard functionality, direct AWS Console links
- **Workshop compliance**: Includes required disclaimer for educational use

## Features

### Core Functionality

- ✅ Extract exports from all CDK stacks across multiple regions
- ✅ Filter exports by prefix (e.g., "Workshop" exports only)
- ✅ Generate responsive HTML dashboard with search capabilities
- ✅ Upload to S3 with CloudFront integration
- ✅ Automatic integration into CDK pipeline

### User Experience

- ✅ Real-time search with highlighting
- ✅ Filter by category or stack name
- ✅ One-click copy to clipboard
- ✅ Direct links to AWS Console resources
- ✅ Mobile-responsive design
- ✅ Professional AWS branding

## Usage

### Command Line Interface

```bash
# Generate complete dashboard (extract + HTML + upload)
python3 scripts/manage-exports.py generate-dashboard

# Extract only Workshop-prefixed exports
python3 scripts/manage-exports.py generate-dashboard --filter-prefix Workshop

# Extract exports to JSON file
python3 scripts/manage-exports.py extract --output exports.json

# Generate HTML from existing JSON
python3 scripts/manage-exports.py generate-html --input exports.json --output dashboard.html

# Upload existing HTML to S3
python3 scripts/manage-exports.py upload-to-s3 --input dashboard.html --bucket my-bucket
```

### CDK Pipeline Integration

The solution automatically integrates with your CDK pipeline as the final stage:

1. **Automatic Execution**: Runs after all CDK stacks are deployed
2. **Multi-Region Detection**: Automatically includes us-east-1 when WAF is enabled
3. **S3 Upload**: Uploads dashboard to assets bucket with CloudFront distribution
4. **URL Generation**: CloudFormation template exposes dashboard URL as output

### Environment Variables

The script uses these environment variables for configuration:

- `AWS_REGION`: Primary region for export scanning
- `CUSTOM_ENABLE_WAF`: Set to 'true' to include us-east-1 region
- `ASSETS_BUCKET_NAME`: S3 bucket for dashboard upload (auto-detected from exports)

## File Structure

```
src/cdk/scripts/
├── manage-exports.py              # Main script with CLI interface
├── templates/
│   └── exports-dashboard.j2       # Professional Jinja2 HTML template
└── README.md                      # This documentation
```

## Template Customization

The HTML template can be customized by modifying `templates/exports-dashboard.j2`:

- **Styling**: Update CSS variables for colors and branding
- **Layout**: Modify HTML structure and component arrangement
- **Functionality**: Enhance JavaScript for additional features
- **Content**: Customize text, disclaimers, and help information

## Integration Details

### CloudFormation Template Enhancement

The solution enhances the existing CloudFormation deployment template:

1. **Lambda Function**: Enhanced `rCDKOutputRetrieverFunction` constructs dashboard URL
2. **Output Addition**: New `oExportsDashboardUrl` output for easy access
3. **URL Construction**: Automatically detects CloudFront or falls back to S3 direct URL

### CDK Pipeline Stage

Added as final pipeline wave in `lib/pipeline.ts`:

```typescript
const exportsDashboardWave = pipeline.addWave('ExportsDashboard');
const exportsDashboardStep = new CodeBuildStep('GenerateExportsDashboard', {
    commands: [
        'pip3 install jinja2 boto3',
        'python3 scripts/manage-exports.py generate-dashboard --filter-prefix Workshop',
    ],
});
```

## Security & Compliance

- **Workshop Disclaimer**: Prominent notice that content is for educational use only
- **No Sensitive Data**: Filters out internal AWS/CDK exports by default
- **Read-Only Access**: Script only reads CloudFormation exports, no modifications
- **Secure Upload**: Uses proper S3 permissions and HTTPS-only access

## Troubleshooting

### Common Issues

**No exports found**: Check that CDK stacks have been deployed and exports exist

```bash
aws cloudformation list-exports --region us-east-1
```

**Permission denied**: Ensure AWS credentials have CloudFormation read access

```bash
aws sts get-caller-identity
```

**Template not found**: Verify templates directory exists and contains `exports-dashboard.j2`

```bash
ls -la scripts/templates/
```

**S3 upload fails**: Check bucket exists and permissions allow PutObject

```bash
aws s3 ls s3://your-assets-bucket/
```

### Debug Mode

Enable detailed logging by setting:

```bash
export AWS_DEFAULT_REGION=us-east-1
python3 scripts/manage-exports.py generate-dashboard --filter-prefix Workshop
```

## Development

### Dependencies

- Python 3.7+
- boto3 (AWS SDK)
- jinja2 (Template engine)

### Testing

Test the script locally:

```bash
# Install dependencies
pip3 install boto3 jinja2

# Test extraction (requires AWS credentials)
python3 scripts/manage-exports.py extract --filter-prefix Workshop

# Test template rendering
python3 scripts/manage-exports.py generate-html --input exports.json
```

## License

This tool is part of the AWS One Observability Workshop and follows the same Apache 2.0 license.

## Resource Cleanup

The `cleanup-resources.ts` script helps identify and delete AWS resources tagged with workshop tags that may not have been properly cleaned up when stacks were deleted.

### Usage

```bash
# Discover all workshop stack names
npm run cleanup -- --discover

# Preview cleanup for a specific stack (recommended first step)
npm run cleanup -- --stack-name MyWorkshopStack --dry-run

# Actually perform the cleanup
npm run cleanup -- --stack-name MyWorkshopStack

# Clean up resources without valid stackName tags
npm run cleanup -- --cleanup-missing-tags --dry-run

# Clean up in a specific region
npm run cleanup -- --stack-name MyWorkshopStack --region us-west-2
```

### Options

- `--stack-name <name>`: Specific stack name to clean up
- `--discover`: List all found workshop stack names
- `--dry-run`: Preview what would be deleted (recommended)
- `--region <region>`: AWS region (default: us-east-1 or AWS_REGION)
- `--cleanup-missing-tags`: Clean up resources without valid stackName tags
- `--skip-confirmation`: Skip confirmation prompts (use with caution)
- `--help`: Show help message

### Resources Cleaned

The script identifies and removes orphaned resources that may persist after stack deletion:

- **CloudWatch Log Groups**: Logs that weren't automatically deleted
- **EBS Volumes**: Unattached volumes (only if in 'available' state)
- **EBS Snapshots**: Snapshots created during stack lifecycle
- **RDS Backups**: DB snapshots and cluster snapshots
- **ECS Task Definitions**: Deregisters task definitions
- **S3 Buckets**: Empties and deletes buckets

All resources are identified by workshop tags (`environment`, `application`, `stackName`).

### Safety Features

- **Dry run mode**: Always test with `--dry-run` first to preview deletions
- **Confirmation prompts**: Requires explicit "yes" confirmation before deletion
- **Tag-based filtering**: Only deletes resources with workshop tags
- **State checking**: Validates resource state before deletion (e.g., EBS volumes must be unattached)

### Warning

This script performs destructive operations that cannot be undone. Always run with `--dry-run` first to verify what will be deleted.

## Contributing

When contributing improvements:

1. Test changes with various export configurations
2. Ensure mobile responsiveness is maintained
3. Validate AWS branding and disclaimer requirements
4. Update this README with new features or usage patterns
