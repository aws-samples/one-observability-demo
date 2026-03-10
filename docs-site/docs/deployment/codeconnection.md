# CodeConnection and Parameter Store Integration

The pipeline supports two modes of operation:

1. **CodeConnection Mode** — Uses AWS CodeConnection to connect directly to GitHub repositories
2. **S3 Fallback Mode** — Uses S3 bucket as the source (default)

Configuration management uses AWS Systems Manager Parameter Store for centralized, secure storage.

## Deploying with CodeConnection

1. Create a CodeConnection in the AWS Console
2. Deploy with the CodeConnection ARN:

```bash
aws cloudformation deploy \
  --template-file src/templates/codebuild-deployment-template.yaml \
  --stack-name one-observability-pipeline \
  --parameter-overrides \
    pCodeConnectionArn=arn:aws:codeconnections:region:account:connection/connection-id \
    pParameterStoreBasePath=/oneobservability/workshop \
  --capabilities CAPABILITY_IAM
```

## Deploying with S3 Fallback

Deploy without the CodeConnection ARN parameter:

```bash
aws cloudformation deploy \
  --template-file src/templates/codebuild-deployment-template.yaml \
  --stack-name one-observability-pipeline \
  --parameter-overrides \
    pParameterStoreBasePath=/oneobservability/workshop \
  --capabilities CAPABILITY_IAM
```

## Parameter Store Configuration

The configuration is automatically populated by the CloudFormation template's CodeBuild process. A single parameter contains the entire `.env` file content:

```bash
# View the configuration parameter
aws ssm get-parameter \
  --name "/petstore/your-stack-name/config" \
  --with-decryption
```

!!! note
    The parameter is managed by CloudFormation and automatically populated during the initial CodeBuild process. Manual changes should be made by updating the source configuration file and rerunning the pipeline.

## Local Development with CodeConnection

1. Create a CodeConnection:
    ```bash
    aws codeconnections create-connection \
      --provider-type GitHub \
      --connection-name one-observability-demo
    ```

2. Configure `.env`:
    ```bash
    CODE_CONNECTION_ARN=arn:aws:codeconnections:us-east-1:123456789012:connection/abc123
    PARAMETER_STORE_BASE_PATH=/one-observability-workshop/
    ```

3. Deploy:
    ```bash
    cdk -a "npx ts-node bin/local.ts" deploy --all
    ```

## Fallback Behavior

- **Source**: If CodeConnection ARN is not provided, S3 bucket source is used automatically
- **Configuration**: If Parameter Store parameters are not found, local `.env` files are used
- **Local Development**: Always uses local `.env` files for immediate iteration
