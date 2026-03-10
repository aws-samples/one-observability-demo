# Image Generation

The image generation system creates pet and food images using Amazon Bedrock Titan Image Generator v2.

## Prerequisites

- AWS CLI v2 with Bedrock support
- Bedrock model access enabled for **Amazon Titan Image Generator G1 v2**
- `jq` installed

## Usage

```bash
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

## Image Categories

| Category | Count | Naming Pattern |
|----------|-------|----------------|
| Bunnies | 4 | `b1.jpg` – `b4.jpg` |
| Kittens | 7 | `k1.jpg` – `k7.jpg` |
| Puppies | 15 | `p1.jpg` – `p15.jpg` |
| Pet Food | 10 | `f1.jpg` – `f10.jpg` |

## CDK Integration

Images are deployed via CDK:

1. Generated images are zipped per category in `static/images/`
2. CDK uploads them to S3 under `petimages/` prefix
3. CloudFront distribution serves images globally
4. Applications construct URLs dynamically: `${IMAGES_CDN_URL}/${imageCode}.jpg`

## Model Access Setup

1. Go to [AWS Bedrock Console](https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess)
2. Enable access for **Amazon Titan Image Generator G1 v2**
3. Wait for approval (typically instant)

## Features

- Exponential backoff retry logic for API rate limiting
- Validation system for count, naming, and file integrity
- Selective generation by category
- Incremental updates (skips existing images)
