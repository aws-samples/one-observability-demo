# Pay for Adoption Go Service

This microservice handles the payment processing for pet adoptions in the Pet Adoptions workshop application.

## API Endpoints

### Complete Adoption
`POST /api/home/completeadoption`

Processes a pet adoption payment and creates a transaction record.

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

## Database Schema

The service uses PostgreSQL to store transaction data with the following schema:

### transactions table
- `id` (SERIAL PRIMARY KEY)
- `pet_id` (VARCHAR)
- `adoption_date` (DATE)
- `transaction_id` (VARCHAR)
- `user_id` (VARCHAR) - **New field added for user tracking**

### transactions_history table
- Same schema as transactions table for historical records

## Recent Changes

### User ID Enhancement
- Added `userid` field to the Adoption struct
- Updated API to require `userId` query parameter
- Enhanced database schema to store user information
- Added user ID to observability traces and logs
- Updated middleware to include user ID in metrics and logging

This enhancement enables user tracking for adoptions, supporting better analytics and user experience features in the pet adoption workshop.

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