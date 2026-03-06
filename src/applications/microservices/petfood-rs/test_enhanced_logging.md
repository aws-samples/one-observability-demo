# Enhanced Logging for PetFood Microservice Troubleshooting

## Summary of Changes Made

I've enhanced the logging in the petfood microservice to help troubleshoot DynamoDB access issues with minimal changes to the codebase. Here are the key improvements:

### 1. Enhanced DynamoDB Error Logging (`cart_repository.rs`)

- **Detailed Error Information**: Added structured logging that captures error codes, messages, request IDs, table names, and regions
- **Specific Error Type Handling**: Added targeted logging for common DynamoDB errors:
  - `ResourceNotFoundException` - Table doesn't exist
  - `AccessDeniedException` - IAM permission issues
  - `UnrecognizedClientException` - Invalid credentials
  - `ThrottlingException` - Rate limiting issues
  - `ServiceUnavailable` - AWS service issues
- **Enhanced Error Messages**: Improved error messages with troubleshooting hints

### 2. AWS Configuration Logging (`config/mod.rs`)

- **AWS Configuration Details**: Added logging of region, endpoints, timeouts, and retry settings
- **Credential Configuration**: Added logging of credential source information (without exposing sensitive data)
- **Connectivity Testing**: Added startup tests for DynamoDB table connectivity
- **Table Status Validation**: Check and log DynamoDB table status during startup

## Testing the Enhanced Logging

### Build and Run the Service

```bash
# Navigate to the petfood service directory
cd src/applications/microservices/petfood-rs

# Build the service
cargo build

# Run with enhanced logging (set log level to debug for maximum detail)
RUST_LOG=debug \
PETFOOD_REGION=us-west-2 \
PETFOOD_FOODS_TABLE_NAME=PetFoods \
PETFOOD_CARTS_TABLE_NAME=PetFoodCarts \
cargo run
```

### Environment Variables for Testing

```bash
# Basic configuration
export PETFOOD_HOST=0.0.0.0
export PETFOOD_PORT=8080
export PETFOOD_REGION=us-west-2
export PETFOOD_FOODS_TABLE_NAME=PetFoods
export PETFOOD_CARTS_TABLE_NAME=PetFoodCarts

# Enable JSON logging for structured output
export PETFOOD_ENABLE_JSON_LOGGING=true

# Set log level for detailed troubleshooting
export RUST_LOG=debug
```

### What You'll See in the Logs

#### 1. Startup Configuration Logging
```
INFO petfood_rs::config: Loading configuration from environment and AWS Parameter Store
INFO petfood_rs::config: Initializing AWS configuration region="us-west-2"
INFO petfood_rs::config: AWS configuration details region="us-west-2" endpoint="default" operation_timeout="60s" attempt_timeout="30s" max_retries=3
INFO petfood_rs::config: AWS credentials configuration access_key_set=true secret_key_set=true session_token_set=false profile="default" role_arn="none"
```

#### 2. DynamoDB Connectivity Testing
```
INFO petfood_rs::config: Testing DynamoDB connectivity foods_table="PetFoods" carts_table="PetFoodCarts"
INFO petfood_rs::config: DynamoDB foods table connectivity validated table="PetFoods" status="ACTIVE"
ERROR petfood_rs::config: DynamoDB carts table connectivity test failed table="PetFoodCarts" error="ResourceNotFoundException: Requested resource not found" region="us-west-2"
```

#### 3. Enhanced DynamoDB Error Logging
```
ERROR petfood_rs::repositories::cart_repository: DynamoDB operation failed with detailed error information error.code="ResourceNotFoundException" error.message="Requested resource not found" error.request_id="ABC123" table_name="PetFoodCarts" region="us-west-2"
ERROR petfood_rs::repositories::cart_repository: DynamoDB table not found table_name="PetFoodCarts" region="us-west-2"
```

### Common Issues and What to Look For

#### 1. Table Not Found
```
ERROR: DynamoDB table not found - check if table exists and is in the correct region
```
**Solution**: Verify the table name and region are correct, create the table if missing

#### 2. Access Denied
```
ERROR: DynamoDB access denied - check IAM permissions for the service role
```
**Solution**: Verify the service has proper IAM permissions for DynamoDB operations

#### 3. Invalid Credentials
```
ERROR: Invalid AWS credentials or region configuration
```
**Solution**: Check AWS credentials configuration and region settings

#### 4. Throttling Issues
```
WARN: DynamoDB throttling detected - consider increasing table capacity
```
**Solution**: Increase DynamoDB table's read/write capacity or enable auto-scaling

### Health Check Endpoint

The service should still respond to health checks even if DynamoDB is failing:

```bash
curl http://localhost:8080/health
```

This should return 200 OK, confirming the service is running but may have database connectivity issues.

## Benefits of These Changes

1. **Minimal Code Changes**: Only enhanced existing logging without changing core business logic
2. **Structured Logging**: All log entries use structured fields for easy parsing and filtering
3. **Troubleshooting Information**: Provides specific guidance for common DynamoDB issues
4. **Startup Validation**: Proactively tests connectivity during service startup
5. **Request Context**: Includes trace IDs and request context for correlation
6. **Non-Breaking**: All changes are backwards compatible and don't affect functionality

## Next Steps

1. **Deploy with Enhanced Logging**: Use the updated service in your environment
2. **Monitor Logs**: Watch for specific error patterns in your log aggregation system
3. **Set Up Alerts**: Create alerts based on specific error codes or patterns
4. **Correlate with Traces**: Use trace IDs to correlate logs with distributed traces

The enhanced logging will help you quickly identify whether the issue is:
- Missing or misconfigured DynamoDB tables
- IAM permission problems
- Network connectivity issues
- AWS service availability problems
- Application configuration errors
