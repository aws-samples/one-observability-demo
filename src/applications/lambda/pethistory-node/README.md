<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Pet History Lambda Function

## Overview
The Pet History Lambda function processes adoption history messages from Amazon SQS and maintains historical records of pet adoptions. This service is part of an event-driven architecture that separates real-time adoption processing from historical data tracking.

**Key Responsibilities:**
1. **Asynchronous history tracking** - Records adoption history without blocking the main adoption flow
2. **Optimistic table creation** - Automatically creates database tables when needed
3. **Schema validation** - Prevents message poisoning with strict validation
4. **Batch processing** - Efficiently handles multiple messages with partial failure support

## Architecture

```
payforadoption-go → SQS Queue → pethistory Lambda → transaction_history table
                                      ↓
                              (Auto-creates table if missing)
```

### Event-Driven Design
- **Real-time adoption**: `payforadoption-go` handles synchronous adoption processing
- **Asynchronous history**: `pethistory` tracks historical data in the background
- **Clean separation**: History tracking failures don't impact adoption success

## Message Processing Flow

1. **SQS Trigger**: Lambda receives adoption history messages from SQS
2. **Schema Validation**: Validates message format using Joi schema
3. **Optimistic Insert**: Attempts to insert directly into `transaction_history` table
4. **Auto Table Creation**: If table doesn't exist (PostgreSQL error 42P01), creates it automatically
5. **Batch Failure Handling**: Uses SQS `ReportBatchItemFailures` for partial batch processing
6. **Retry Mechanism**: Failed messages are retried by SQS, successful table creation enables future success

## Message Schema

The function expects SQS messages with the following JSON structure:

```json
{
  "transactionId": "123e4567-e89b-12d3-a456-426614174000",
  "petId": "pet123",
  "petType": "dog",
  "userId": "user456",
  "adoptionDate": "2025-08-08T10:30:00Z",
  "timestamp": "2025-08-08T10:30:00Z"
}
```

### Schema Validation Rules
- `transactionId`: Must be a valid UUID
- `petId`: Required string
- `petType`: Required string
- `userId`: Required string
- `adoptionDate`: Must be a valid ISO date string
- `timestamp`: Must be a valid ISO date string

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `RDS_SECRET_ARN` | ARN of the RDS secret in Secrets Manager | `arn:aws:secretsmanager:us-west-2:123456789012:secret:rds-secret` |
| `AWS_REGION` | AWS region for services | `us-west-2` |

## Database Operations

### Transaction History Table
The function automatically creates and inserts into the `transaction_history` table:

```sql
CREATE TABLE IF NOT EXISTS transaction_history (
    id SERIAL PRIMARY KEY,
    pet_id VARCHAR(255) NOT NULL,
    transaction_id VARCHAR(255) NOT NULL,
    adoption_date TIMESTAMP NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes created automatically
CREATE INDEX IF NOT EXISTS idx_transaction_history_pet_id ON transaction_history(pet_id);
CREATE INDEX IF NOT EXISTS idx_transaction_history_user_id ON transaction_history(user_id);
CREATE INDEX IF NOT EXISTS idx_transaction_history_adoption_date ON transaction_history(adoption_date);
CREATE INDEX IF NOT EXISTS idx_transaction_history_transaction_id ON transaction_history(transaction_id);
```

### Optimistic Table Creation
- **First attempt**: Tries to INSERT directly (fastest path)
- **On table missing**: Catches PostgreSQL error code `42P01` and creates table + indexes
- **Subsequent attempts**: INSERT succeeds normally after table exists
- **Self-healing**: Service creates its own dependencies automatically

### Database Connection
- Uses AWS Secrets Manager to retrieve database credentials
- Establishes PostgreSQL connection using the `pg` library
- Handles connection errors gracefully with SQS retry mechanism

## Error Handling & Batch Processing

### SQS Batch Processing
The function uses SQS's `ReportBatchItemFailures` feature for efficient batch processing:

```javascript
// Response format for SQS
{
  "batchItemFailures": [
    { "itemIdentifier": "failed-message-id" }
  ],
  "processedCount": 8,
  "results": [...]
}
```

### Error Types
1. **Schema Validation Errors**: Invalid JSON or missing fields → Message goes to batch failures
2. **Database Connection Errors**: Network/auth issues → Message retried by SQS
3. **Table Missing (42P01)**: Creates table automatically → Message retried and succeeds
4. **Other Database Errors**: Logged and message goes to batch failures

### Retry Strategy
- **Successful messages**: Automatically deleted from SQS
- **Failed messages**: Remain in SQS for retry based on queue configuration
- **Persistent failures**: Eventually move to Dead Letter Queue (DLQ)

## Observability

### CloudWatch Application Signals
- **Automatic instrumentation** with AWS Distro for OpenTelemetry (ADOT)
- **Service name**: `pethistory` for easy identification
- **Distributed tracing** across the adoption workflow
- **Performance metrics** and dependency mapping
- **Error tracking** and alerting

### CloudWatch Logs
- **Structured JSON logging** for all operations
- **Processing metrics**: Success/failure counts, timing
- **Error details**: Stack traces and context information
- **Table creation events**: Logged when auto-creation occurs

### Key Metrics
- **Processing rate**: Messages processed per minute
- **Error rate**: Failed message percentage
- **Table creation events**: When auto-creation occurs
- **Batch efficiency**: Partial vs full batch failures

## Testing

### Unit Tests
```bash
npm test
```

The test suite covers:
- ✅ Single message processing
- ✅ Batch message processing
- ✅ Schema validation failures
- ✅ Mixed success/failure batches
- ✅ Correct SQS response format
- ✅ Error handling scenarios

### Integration Testing
```bash
# Send test message to SQS queue
aws sqs send-message \
  --queue-url "https://sqs.us-west-2.amazonaws.com/123456789012/adoption-history-queue" \
  --message-body '{
    "transactionId": "123e4567-e89b-12d3-a456-426614174000",
    "petId": "pet123",
    "petType": "dog",
    "userId": "user456",
    "adoptionDate": "2025-08-08T10:30:00Z",
    "timestamp": "2025-08-08T10:30:00Z"
  }'
```

### Local Development
```bash
# Install dependencies
npm install

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format

# Local SAM testing
sam build
sam local invoke PetHistoryFunction --event events/test-sqs-event.json
```

## Deployment

### AWS SAM Deployment
```bash
# Interactive deployment
./deploy.sh

# Manual deployment
sam build && sam deploy --guided
```

### Configuration
- **Function Name**: `pethistory`
- **Runtime**: Node.js 18.x
- **Memory**: 512 MB
- **Timeout**: 60 seconds
- **SQS Batch Size**: 10 messages
- **Batch Window**: 5 seconds
- **Dead Letter Queue**: Configured for failed messages

## Monitoring and Alerts

### Key Metrics to Monitor
1. **Processing Rate**: Messages processed per minute
2. **Error Rate**: Failed message percentage
3. **SQS Queue Depth**: Unprocessed history messages
4. **Table Creation Events**: Auto-creation frequency
5. **DLQ Messages**: Messages requiring investigation

### Recommended CloudWatch Alarms
- Lambda error rate > 5%
- Lambda duration > 50 seconds
- SQS queue depth > 50 messages
- DLQ message count > 0
- Table creation events (for monitoring)

## Security

### IAM Permissions
The Lambda function requires:
- `secretsmanager:GetSecretValue` - Database credentials
- `rds-db:connect` - Database connection (if using IAM auth)
- `sqs:ReceiveMessage`, `sqs:DeleteMessage` - SQS processing
- CloudWatch Application Signals permissions (auto-granted)

### Network Security
- **VPC Deployment**: Private subnets with NAT Gateway
- **Security Groups**: Restrict database access to Lambda only
- **VPC Endpoints**: AWS services access without internet routing

## Architecture Benefits

### Event-Driven Design
- **Decoupled services**: History tracking independent of adoption flow
- **Resilient**: History failures don't impact adoptions
- **Scalable**: Independent scaling based on workload
- **Maintainable**: Clear domain boundaries

### Optimistic Table Creation
- **Self-healing**: Creates dependencies automatically
- **Zero-downtime**: No manual setup required
- **Performance**: Fast path for normal operations
- **Idempotent**: Safe to run multiple times

### Batch Processing
- **Efficient**: Processes multiple messages together
- **Partial failures**: Doesn't fail entire batch for single message
- **Cost-effective**: Reduces Lambda invocations
- **Reliable**: SQS handles retry logic automatically

## Troubleshooting

### Common Issues

1. **Messages Not Being Processed**
   - Check SQS queue for messages in flight
   - Verify Lambda function is triggered by SQS
   - Review CloudWatch logs for errors

2. **Schema Validation Failures**
   - Check message format in SQS queue
   - Verify all required fields are present
   - Ensure correct data types (UUID, ISO dates)

3. **Database Connection Issues**
   - Verify RDS secret ARN is correct
   - Check VPC/security group configuration
   - Ensure database is accessible from Lambda subnet

4. **Table Creation Issues**
   - Check database permissions for CREATE TABLE
   - Verify PostgreSQL version compatibility
   - Review CloudWatch logs for creation attempts

### Debugging Steps
1. **Check CloudWatch Logs** for detailed error information
2. **Review Application Signals** service map for dependencies
3. **Monitor SQS metrics** for processing delays
4. **Inspect DLQ messages** for patterns in failures
5. **Use X-Ray traces** for end-to-end request tracking

## Workshop Learning Objectives

This service demonstrates:
- ✅ **Event-driven architecture** with asynchronous processing
- ✅ **SQS batch processing** with partial failure handling
- ✅ **Optimistic database operations** and auto-recovery
- ✅ **Schema validation** and data integrity
- ✅ **CloudWatch Application Signals** observability
- ✅ **Microservices patterns** and domain separation
- ✅ **Error handling strategies** in distributed systems
- ✅ **Infrastructure as Code** with AWS SAM

Perfect for learning modern serverless patterns and AWS observability tools! 🚀