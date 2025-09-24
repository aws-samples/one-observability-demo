# RDS Seeder Python Lambda Function

This Lambda function seeds the RDS Aurora PostgreSQL database with sample pet adoption data. It's designed to run inside the VPC to access the private RDS cluster.

## Purpose

Replaces the TypeScript `seed-rds.ts` script to enable database seeding from within the VPC, solving the connectivity issue with private subnets.

## Function Overview

The Lambda function performs the following operations:
1. Retrieves database credentials from AWS Secrets Manager via SSM Parameter Store
2. Connects to the RDS Aurora PostgreSQL cluster
3. Creates necessary database tables (pets, transactions)
4. Seeds pet data from `seed.json`
5. Adds sample adoption transaction records
6. Verifies the seeded data

## Event Parameters

The function expects the following event payload:

```json
{
  "secret_parameter_name": "/workshop/rdssecretarn"
}
```

Where `secret_parameter_name` is the SSM Parameter Store parameter name that contains the RDS secret ARN.

## Database Schema

### pets table
- `id` (SERIAL PRIMARY KEY)
- `petid` (VARCHAR(10) UNIQUE) - Pet identifier
- `pettype` (VARCHAR(50)) - Type of pet (puppy, kitten, bunny)
- `availability` (VARCHAR(10)) - Availability status
- `cuteness_rate` (INTEGER) - Cuteness rating 1-5
- `image` (VARCHAR(100)) - Image reference
- `petcolor` (VARCHAR(50)) - Pet color
- `price` (DECIMAL(10,2)) - Adoption price
- `description` (TEXT) - Pet description
- `created_at`, `updated_at` (TIMESTAMP)

### transactions table
- `id` (SERIAL PRIMARY KEY)
- `pet_id` (VARCHAR(10)) - Reference to pet
- `transaction_id` (VARCHAR(50)) - Unique transaction identifier
- `adoption_date` (TIMESTAMP)
- `adopter_name` (VARCHAR(255))
- `adopter_email` (VARCHAR(255))
- `status` (VARCHAR(20)) - Transaction status
- `notes` (TEXT) - Additional notes

## Dependencies

- `boto3` - AWS SDK for Python
- `psycopg2-binary` - PostgreSQL adapter for Python

## VPC Configuration

The Lambda function must be deployed with:
- **VPC**: Same VPC as the RDS cluster
- **Subnets**: Isolated subnets (same as RDS cluster)
- **Security Groups**: Access to RDS security group on PostgreSQL port (5432)

## IAM Permissions Required

- `ssm:GetParameter` - To retrieve secret ARN from Parameter Store
- `secretsmanager:GetSecretValue` - To retrieve database credentials
- Standard Lambda execution permissions

## Error Handling

The function includes exponential backoff retry logic for AWS API throttling and comprehensive error handling for database operations.

## Return Value

**Success (200):**
```json
{
  "statusCode": 200,
  "body": {
    "message": "RDS seeding completed successfully",
    "pets_seeded": 26,
    "adoptions_seeded": 3,
    "verification": {
      "pets_count": 26,
      "transactions_count": 3,
      "sample_pets": [...]
    }
  }
}
```

**Error (400/500):**
```json
{
  "statusCode": 400,
  "body": {
    "error": "secret_parameter_name is required in event payload"
  }
}
