# Pet Image Generation and Seeding System

This document describes the comprehensive image generation and seeding solution for the One Observability Demo pet store application. The system generates and manages images for bunnies, kittens, puppies, and pet food using Amazon Bedrock Titan Image Generator v2.

## Overview

The system provides:
- **Unified Image Generation**: Uses Amazon Bedrock to generate contextually appropriate images
- **Multi-Category Support**: Handles bunnies, kittens, puppies, and pet food
- **CDK Integration**: Seamlessly integrates with AWS CDK deployment
- **CloudFront Distribution**: Serves images via CDN with proper caching
- **Clean Architecture**: Applications dynamically construct CloudFront URLs

## File Structure

```
src/cdk/scripts/
├── generate-images.sh          # Primary bash implementation (recommended)
├── generate-images.py          # Alternative Python implementation (has dependency issues)
├── seed.json                   # Pet data (bunnies, kittens, puppies)
├── petfood-seed.json          # Pet food product data
├── seed-dynamodb.sh           # DynamoDB seeding script
└── utils/
    └── throttle-backoff.ts    # Utility for API throttling

static/images/
├── bunnies.zip               # 4 bunny images (b1.jpg - b4.jpg)
├── kittens.zip              # 7 kitten images (k1.jpg - k7.jpg)
├── puppies.zip              # 15 puppy images (p1.jpg - p15.jpg)
└── petfood.zip             # 10 petfood images (f1.jpg - f10.jpg)

docs/
└── SEEDING_IMAGE_GENERATION.md # This documentation
```

## Image Generation Script

### Bash Script (Primary Implementation)
```bash
# Navigate to scripts directory
cd src/cdk/scripts

# Validate current status
./generate-images.sh --validate-only

# Generate all missing images
./generate-images.sh --create-zips

# Generate specific categories
./generate-images.sh --type kittens,petfood --create-zips

# Generate with different region
./generate-images.sh --region us-west-2 --create-zips
```

**Note**: The bash script is the recommended implementation as it uses AWS CLI and avoids Python dependency issues with Bedrock support.

## Prerequisites

### For Image Generation
1. **AWS CLI v2** with Bedrock support
2. **AWS Credentials** configured (`aws configure`)
3. **Bedrock Model Access** enabled in AWS Console
4. **jq** for JSON processing (`brew install jq` on macOS)

### For CDK Deployment
1. **Node.js** and **npm**
2. **AWS CDK v2** (`npm install -g aws-cdk`)
3. **Docker** (for container builds)

## Model Access Setup

1. Go to AWS Bedrock Console: `https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess`
2. Enable access for **Amazon Titan Image Generator G1 v2**
3. Wait for approval (typically instant for most accounts)

## Image Naming Patterns

The system follows consistent naming patterns based on seed data:

### Pet Images
- **Bunnies**: `b1.jpg`, `b2.jpg`, `b3.jpg`, `b4.jpg` (4 total)
- **Kittens**: `k1.jpg`, `k2.jpg`, ..., `k7.jpg` (7 total)
- **Puppies**: `p1.jpg`, `p2.jpg`, ..., `p15.jpg` (15 total)

### Pet Food Images
- **Pet Food**: `f1.jpg`, `f2.jpg`, ..., `f10.jpg` (10 total)

## Prompt Engineering

The system uses sophisticated, contextually intelligent prompts:

### Pet Images
```
Adorable fluffy bunny with brown fur sitting next to a natural wooden bowl,
organic rustic presentation with natural lighting, professional pet photography,
clean studio background with soft shadows, high resolution, appealing and cute
```

### Pet Food Images
```
Premium dry pet food with visible kibble pieces in ceramic dog bowl,
appetizing and fresh appearance, clean product photography, natural lighting,
appealing presentation, clean white background, high resolution, commercial quality
```

## CDK Integration

The images are automatically deployed via CDK:

### Configuration (`src/cdk/bin/environment.ts`)
```typescript
export const PET_IMAGES = [
    '../../static/images/bunnies.zip',
    '../../static/images/kittens.zip',
    '../../static/images/puppies.zip',
    '../../static/images/petfood.zip',
];
```

### CloudFront Distribution
- **S3 Origin**: Images uploaded to S3 bucket under `petimages/` prefix
- **CDN Caching**: Optimized for static content delivery
- **Global Distribution**: Low-latency access worldwide

### Application Integration
Applications construct CloudFront URLs dynamically:
```typescript
const imageUrl = `${IMAGES_CDN_URL}/${imageCode}.jpg`;
```

Where:
- `IMAGES_CDN_URL` = CloudFront distribution domain
- `imageCode` = Simple filename from seed data (e.g., `b1`, `k3`, `p15`, `f7`)

## Usage Examples

### Validate Current State
```bash
cd src/cdk/scripts
./generate-images.sh --validate-only
```

Output:
```
📊 Validation Results:
─────────────────────────────────
✅ Bunny: 4/4 images
✅ Kitten: 7/7 images
✅ Puppy: 15/15 images
✅ Petfood: 10/10 images
```

### Generate Missing Images
```bash
# Generate all categories with zip files
./generate-images.sh --create-zips

# Generate only pet food images
./generate-images.sh --type petfood --create-zips
```

### Deploy with CDK
```bash
cd src/cdk
npm install
npx cdk deploy --all
```

## Advanced Features

### Retry Logic
- **Exponential Backoff**: Handles API rate limiting gracefully
- **Error Classification**: Distinguishes retryable vs non-retryable errors
- **Jitter**: Prevents thundering herd problems

### Validation System
- **Count Verification**: Ensures correct number of images per category
- **Naming Validation**: Verifies consistent naming patterns
- **File Integrity**: Checks zip file contents

### Selective Generation
- **Category Filtering**: Generate specific pet types only
- **Incremental Updates**: Skip existing images
- **Batch Processing**: Efficient handling of large image sets

## Troubleshooting

### Common Issues

**1. AWS Credentials Not Configured**
```bash
aws configure
# Enter your Access Key ID, Secret Key, Region, and output format
```

**2. Bedrock Model Access Denied**
```
Error: Model amazon.titan-image-generator-v2:0 not available
```
Solution: Enable model access in Bedrock console

**3. Region Not Supported**
```
Error: Cannot access Bedrock in region us-west-1
```
Solution: Use supported regions (`us-east-1`, `us-west-2`)

**4. Missing Dependencies**
```bash
# Install jq
brew install jq  # macOS
apt-get install jq  # Linux

# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
```

**5. Python Boto3 Version Issues**
```
Error: boto3 version 1.26.165 does not support Bedrock service
```
Solution: Use the bash script instead (`generate-images.sh`) which relies on AWS CLI

### Debugging Tips

1. **Check AWS CLI Version**: `aws --version` (must be v2)
2. **Test Bedrock Access**: `aws bedrock list-foundation-models --region us-east-1`
3. **Validate Credentials**: `aws sts get-caller-identity`
4. **Check jq Installation**: `jq --version`

## Architecture Benefits

1. **Scalable**: Easy to add new pet categories or modify image counts
2. **Cost Effective**: Images generated once, served globally via CDN
3. **Maintainable**: Clean separation between generation and consumption
4. **Production Ready**: Includes error handling, retry logic, and validation

## Seeding Workflow

### Complete Setup Process

1. **Prepare Environment**
   ```bash
   # Install prerequisites
   brew install jq  # or apt-get install jq
   aws configure
   ```

2. **Enable Bedrock Access**
   - Visit AWS Bedrock Console
   - Enable Titan Image Generator G1 v2 model access

3. **Generate Images**
   ```bash
   cd src/cdk/scripts
   ./generate-images.sh --validate-only  # Check current state
   ./generate-images.sh --create-zips    # Generate missing images
   ```

4. **Deploy Infrastructure**
   ```bash
   cd src/cdk
   npm install
   npx cdk deploy --all
   ```

5. **Verify Deployment**
   - Check CloudFront distribution is active
   - Test image URLs in applications
   - Monitor CloudWatch logs for any issues

## Implementation Notes

- **Primary Script**: Use `generate-images.sh` (bash implementation)
- **Python Alternative**: `generate-images.py` exists but has boto3 dependency issues requiring version >= 1.34.0 for Bedrock support
- **AWS CLI Dependency**: The bash script uses `aws bedrock-runtime invoke-model` which is more reliable across environments

For additional support, refer to the AWS Bedrock documentation or check the existing Lambda implementation in `src/applications/lambda/petfood-image-generator-python/`.
