# Pay for Adoption Go Service

This microservice handles the complete pet adoption workflow with a clean separation between real-time adoption processing and asynchronous history tracking. The service implements modern event-driven architecture patterns for optimal performance and reliability.

## Architecture Overview

```
POST /completeadoption → payforadoption-go:
├── CreateTransaction() → transactions table (synchronous)
├── UpdateAvailability() → petstatus service (synchronous)  
└── SendHistoryMessage() → SQS → pethistory → transaction_history table (async)
```

### Design Principles
- **Real-time adoption flow**: Critical operations (transaction + pet status) are synchronous
- **Asynchronous history tracking**: Non-critical historical data is processed in background
- **Clean domain boundaries**: Clear separation between current transactions and historical records
- **Resilient design**: History tracking failures don't impact adoption success

## API Endpoints

### Complete Adoption
`POST /api/completeadoption`

Processes a complete pet adoption workflow including payment, database transaction, pet status update, and history tracking.

**Query Parameters:**
- `petId` (required): The ID of the pet being adopted
- `petType` (required): The type of pet (e.g., "dog", "cat", "bunny")
- `userId` (required): The ID of the user adopting the pet

**Response:**
```json
{
  "transactionid": "123e4567-e89b-12d3-a456-426614174000",
  "petid": "pet123",
  "pettype": "puppy",
  "userid": "user456",
  "adoptiondate": "2025-08-08T10:30:00Z"
}
```

**Processing Flow:**
1. **Generate transaction ID** - Creates unique UUID for adoption
2. **Create transaction record** - Writes to `transactions` table (synchronous)
3. **Update pet availability** - Calls petstatus service to mark pet as adopted (synchronous)
4. **Send history message** - Publishes to SQS for background processing (asynchronous)

### Health Check
`GET /health/status`

Returns the health status of the service.

### Cleanup Adoptions
`POST /api/cleanupadoptions`

Clears the current transactions table. Historical data is maintained separately by the pethistory service.

### Trigger Seeding
`POST /api/triggerseeding`

Seeds the DynamoDB table with sample pet data and creates the `transactions` SQL table.

## Database Operations

### Transactions Table
The service manages the current transactions table for real-time adoption data:

```sql
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    pet_id VARCHAR,
    adoption_date DATE,
    transaction_id VARCHAR,
    user_id VARCHAR
);
```

### Repository Methods

#### CreateTransaction
```go
func (r *repo) CreateTransaction(ctx context.Context, a Adoption) error
```
- **Purpose**: Writes adoption record directly to transactions table
- **Synchronous**: Part of critical adoption path
- **Error handling**: Failures block adoption completion
- **Observability**: Traced and logged for monitoring

#### SendHistoryMessage  
```go
func (r *repo) SendHistoryMessage(ctx context.Context, a Adoption) error
```
- **Purpose**: Sends adoption data to SQS for historical tracking
- **Asynchronous**: Non-blocking background operation
- **Error handling**: Failures logged but don't block adoption
- **Resilient**: History tracking is separate from adoption success

## Event-Driven Architecture

### SQS Integration
The service publishes adoption history messages to Amazon SQS for asynchronous processing by the `pethistory` Lambda function.

#### Message Format
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

#### Message Attributes
- `PetType`: For message filtering and routing
- `UserID`: For user-specific processing  
- `TransactionID`: For correlation and deduplication

#### Processing Flow
1. **payforadoption-go** → Publishes message to SQS
2. **SQS** → Triggers pethistory Lambda function
3. **pethistory** → Processes message and writes to `transaction_history` table

### Benefits of Event-Driven Design
- ✅ **Performance**: Real-time adoption flow is fast (no SQS dependency)
- ✅ **Reliability**: History tracking failures don't break adoptions
- ✅ **Scalability**: Independent scaling of adoption vs history processing
- ✅ **Maintainability**: Clear domain boundaries and responsibilities
- ✅ **Observability**: Separate metrics and tracing for each concern

## Error Handling & Resilience

### Synchronous Operations (Critical Path)
- **Database transaction failures**: Block adoption and return error
- **Pet status update failures**: Block adoption and return error
- **Proper error propagation**: Client receives clear error messages

### Asynchronous Operations (Non-Critical)
- **SQS message failures**: Logged as warnings but don't block adoption
- **History tracking issues**: Monitored separately from adoption success
- **Graceful degradation**: Adoption succeeds even if history tracking fails

### Error Mode Scenarios
The service includes comprehensive error simulation for workshop scenarios:

#### Memory Leak Mode (Bunny Adoptions)
```go
if petType == "bunny" {
    if s.repository.ErrorModeOn(ctx) {
        memoryLeak()
        return a, errors.New("illegal memory allocation")
    }
}
```

- **Trigger**: Adopting pets with type "bunny" when error mode is enabled
- **Behavior**: Simulates memory pressure and allocation failures
- **Purpose**: Demonstrates memory monitoring and alerting in AWS

#### Error Mode Control
- **Parameter**: `/petstore/errormode1` in AWS Systems Manager Parameter Store
- **Values**: `"true"` (enabled) or `"false"` (disabled)
- **Scope**: Affects all bunny adoptions when enabled

## Observability

### CloudWatch Application Signals
- **Automatic instrumentation** with distributed tracing
- **Service maps** showing dependencies (database, petstatus, SQS)
- **Performance metrics** for each operation
- **Error tracking** and alerting

### Key Metrics
- **Adoption success rate**: Percentage of successful adoptions
- **Database operation latency**: Transaction creation timing
- **Pet status update latency**: External service call timing
- **SQS message publish rate**: History message throughput
- **Error rates**: By operation type and error category

### Distributed Tracing
- **End-to-end traces** from API call to database write
- **Service dependencies** clearly mapped
- **Performance bottlenecks** easily identified
- **Error correlation** across service boundaries

## Configuration

### Environment Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `RDS_SECRET_ARN` | ARN of the RDS secret in Secrets Manager | `arn:aws:secretsmanager:us-west-2:123456789012:secret:rds-secret` |
| `SQS_QUEUE_URL` | URL of the SQS queue for history messages | `https://sqs.us-west-2.amazonaws.com/123456789012/adoption-history` |
| `UPDATE_ADOPTION_URL` | URL of the pet status updater service | `https://api.example.com/update-pet-status` |
| `DYNAMODB_TABLE` | DynamoDB table name for pet data | `PetAdoptions` |
| `S3_BUCKET_NAME` | S3 bucket for pet images | `pet-adoption-images` |

### AWS Services Integration
- **Amazon RDS**: PostgreSQL database for transactions
- **Amazon SQS**: Message queue for history processing
- **Amazon DynamoDB**: Pet catalog and availability
- **AWS Secrets Manager**: Database credentials
- **AWS Systems Manager**: Configuration parameters
- **Amazon S3**: Pet image storage

## Development

### Building
```bash
go mod tidy
go build -o payforadoption .
```

### Running Locally
```bash
./payforadoption
```

### Testing
```bash
# Run unit tests
go test ./payforadoption -v

# Run integration tests
go test ./payforadoption -tags=integration -v

# Test with coverage
go test ./payforadoption -cover
```

### Local Development Setup
1. **PostgreSQL**: Local database for transactions table
2. **LocalStack**: Local AWS services (SQS, DynamoDB, S3)
3. **Environment variables**: Set required configuration
4. **Mock services**: Use test doubles for external dependencies

## Deployment

### ECS Deployment
The service runs on Amazon ECS with the following configuration:
- **Runtime**: Go 1.23
- **Memory**: 512 MB
- **CPU**: 256 units
- **Health check**: `/health/status` endpoint
- **Auto-scaling**: Based on CPU and memory utilization

### Docker Build
```bash
# Build for production (Linux/AMD64)
docker buildx build --platform linux/amd64 -t payforadoption:latest .

# Local development
docker build -t payforadoption:dev .
```

### Infrastructure as Code
- **AWS CDK**: Primary deployment method
- **CloudFormation**: Generated from CDK
- **ECS Service**: Auto-scaling and load balancing
- **Application Load Balancer**: Traffic distribution
- **VPC**: Private subnets with NAT Gateway

## Monitoring and Alerting

### Key Metrics to Monitor
1. **Adoption Success Rate**: Should be > 95%
2. **API Response Time**: Should be < 2 seconds
3. **Database Connection Pool**: Monitor for exhaustion
4. **SQS Message Publish Rate**: History tracking throughput
5. **Error Rate by Pet Type**: Identify problematic scenarios

### Recommended CloudWatch Alarms
- API error rate > 5%
- Database connection failures > 10/minute
- Average response time > 3 seconds
- SQS message publish failures > 1%
- Memory utilization > 80%

### Application Signals Benefits
- **Zero-code instrumentation**: Automatic observability
- **Service dependency mapping**: Visual architecture understanding
- **Performance insights**: Bottleneck identification
- **Error correlation**: Root cause analysis
- **SLA monitoring**: Service level objective tracking

## Workshop Learning Objectives

This service demonstrates:
- ✅ **Event-driven architecture** with synchronous and asynchronous patterns
- ✅ **Domain separation** between real-time and historical data
- ✅ **Microservices communication** via REST APIs and message queues
- ✅ **Database integration** with PostgreSQL and connection management
- ✅ **Error handling strategies** for distributed systems
- ✅ **Observability patterns** with CloudWatch Application Signals
- ✅ **Resilience patterns** with graceful degradation
- ✅ **Modern Go development** with clean architecture principles

Perfect for learning AWS observability tools and modern microservices patterns! 🚀

## Related Documentation
- [ERROR_MODE_GUIDE.md](ERROR_MODE_GUIDE.md) - Comprehensive error simulation scenarios
- [DATABASE_CONNECTION_EXHAUSTION.md](DATABASE_CONNECTION_EXHAUSTION.md) - Real database exhaustion patterns
- [EVENT_DRIVEN_ARCHITECTURE.md](EVENT_DRIVEN_ARCHITECTURE.md) - SQS integration details
- [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md) - Architecture evolution and improvements