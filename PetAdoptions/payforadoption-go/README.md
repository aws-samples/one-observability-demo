# Pay for Adoption Go Service

This microservice handles the payment processing for pet adoptions in the Pet Adoptions workshop application using an event-driven architecture with Amazon SQS.

## API Endpoints

### Complete Adoption
`POST /api/home/completeadoption`

Processes a pet adoption payment and sends an adoption message to SQS for asynchronous processing.

**Query Parameters:**
- `petId` (required): The ID of the pet being adopted
- `petType` (required): The type of pet (e.g., "dog", "cat", "bunny")
- `userId` (required): The ID of the user adopting the pet

**Response:**
```json
{
  "transactionid": "uuid-string",
  "petid": "pet123",
  "pettype": "puppy",
  "userid": "user456",
  "AdoptionDate": "2025-08-08T10:30:00Z"
}
```

### Health Check
`GET /health/status`

Returns the health status of the service.

### Cleanup Adoptions
`POST /api/home/cleanupadoptions`

Moves current transactions to history and clears the transactions table.

### Trigger Seeding
`POST /api/home/triggerseeding`

Seeds the DynamoDB table with sample pet data and creates SQL tables.

## Event-Driven Architecture

The service uses Amazon SQS for asynchronous message processing:

### SQS Message Format
```json
{
  "transactionId": "uuid-string",
  "petId": "pet123",
  "petType": "dog", 
  "userId": "user456",
  "adoptionDate": "2025-08-08T10:30:00Z",
  "timestamp": "2025-08-08T10:30:00Z"
}
```

### Message Attributes
- `PetType`: For message filtering and routing
- `UserID`: For user-specific processing  
- `TransactionID`: For correlation and deduplication

Database operations are handled by a separate Lambda function (out of scope) that processes messages from the SQS queue.

## Recent Changes

### User ID Enhancement
- Added `userid` field to the Adoption struct
- Updated API to require `userId` query parameter
- Enhanced database schema to store user information
- Added user ID to observability traces and logs
- Updated middleware to include user ID in metrics and logging

### Event-Driven Architecture
- **Replaced direct database writes** with Amazon SQS message publishing
- **Asynchronous processing** for improved performance and scalability
- **Message-based observability** with SQS metrics and tracing
- **Decoupled architecture** separating payment processing from data persistence
- **Modern microservices patterns** for educational workshop scenarios

### Enhanced Error Mode
- Comprehensive degraded experience scenarios based on pet type
- Realistic failure patterns for AWS observability workshop
- **Real database connection exhaustion** for authentic PostgreSQL monitoring scenarios
- Advanced tracing and logging for debugging practice
- Multiple degradation strategies: memory pressure, circuit breakers, real database exhaustion, partial failures

These enhancements enable user tracking, event-driven processing, and realistic failure scenarios for adoptions, supporting comprehensive AWS observability learning in the pet adoption workshop.

**Documentation:**
- [ERROR_MODE_GUIDE.md](ERROR_MODE_GUIDE.md) - Detailed error mode scenarios
- [DATABASE_CONNECTION_EXHAUSTION.md](DATABASE_CONNECTION_EXHAUSTION.md) - Real database exhaustion
- [EVENT_DRIVEN_ARCHITECTURE.md](EVENT_DRIVEN_ARCHITECTURE.md) - SQS integration details

## Building and Running

```bash
go mod tidy
go build -o payforadoption .
./payforadoption
```

## Testing

```bash
go test ./payforadoption -v
```