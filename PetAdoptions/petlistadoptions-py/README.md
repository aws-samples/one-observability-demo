# Pet List Adoptions Service

A modern Python service for listing pet adoptions with enrichment from pet search services.

## Features

- **FastAPI Framework**: High-performance async web framework with automatic API documentation
- **ADOT Integration**: AWS Distro for OpenTelemetry for tracing and monitoring
- **Prometheus Metrics**: Request count and latency metrics
- **AWS Integration**: Secrets Manager and Parameter Store support
- **PostgreSQL Database**: Connection with psycopg2
- **Type Safety**: Pydantic models for request/response validation
- **Health Checks**: `/health/status` endpoint
- **REST API**: `/api/adoptionlist/` endpoint
- **Auto Documentation**: Interactive API docs at `/docs`

## Environment Variables

- `APP_PET_SEARCH_URL`: URL for the pet search service
- `APP_RDS_SECRET_ARN`: ARN of the RDS secret in AWS Secrets Manager
- `PORT`: Application port (default: 80)

## Local Development with Docker Compose

The easiest way to test the service locally is using Docker Compose:

```bash
# Start all services (PostgreSQL, Pet Search Mock, and the main service)
docker-compose up --build

# Access the service
curl http://localhost:80/health/status
curl http://localhost:80/api/adoptionlist/
curl http://localhost:80/docs
```

### What's Included

- **PostgreSQL Database**: Local PostgreSQL instance with sample data
- **Mock Pet Search Service**: MockServer providing mock pet search responses
- **Pet List Adoptions Service**: The main FastAPI application

### Local Testing

The docker-compose setup includes:
- Sample adoption data in PostgreSQL
- Mock pet search responses
- Health checks and dependency management
- Local secret file for database connection

## Database Configuration

The service uses AWS Secrets Manager to securely store RDS connection details. The secret should contain a JSON object with the following structure:

```json
{
  "engine": "postgresql",
  "host": "your-rds-endpoint.region.rds.amazonaws.com",
  "username": "your_username",
  "password": "your_password",
  "dbname": "your_database_name",
  "port": 5432
}
```

### Configuration Priority

1. **Environment Variables**: `APP_PET_SEARCH_URL` and `APP_RDS_SECRET_ARN`
2. **Parameter Store Fallback**: If env vars are not set, fetches from:
   - `/petstore/rdssecretarn`
   - `/petstore/searchapiurl`

### AWS Setup

1. **Create RDS Secret**:
   ```bash
   aws secretsmanager create-secret \
     --name "petstore/rds-credentials" \
     --description "RDS connection details for petstore" \
     --secret-string '{"engine":"postgresql","host":"your-rds-endpoint","username":"your_username","password":"your_password","dbname":"your_database","port":5432}'
   ```

2. **Set Parameter Store Values** (optional fallback):
   ```bash
   aws ssm put-parameter --name "/petstore/rdssecretarn" --value "arn:aws:secretsmanager:region:account:secret:petstore/rds-credentials" --type String
   aws ssm put-parameter --name "/petstore/searchapiurl" --value "http://your-pet-search-service/" --type String
   ```

## API Endpoints

- `GET /health/status`: Health check endpoint
- `GET /api/adoptionlist/`: List adoptions with pet information
- `GET /metrics`: Prometheus metrics endpoint
- `GET /docs`: Interactive API documentation (Swagger UI)
- `GET /redoc`: Alternative API documentation (ReDoc)

## Local Development

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Set environment variables:
   ```bash
   export APP_PET_SEARCH_URL="http://your-pet-search-service/"
   export APP_RDS_SECRET_ARN="arn:aws:secretsmanager:region:account:secret:your-secret"
   ```

3. Run the application:
   ```bash
   python app.py
   ```

   Or with uvicorn directly:
   ```bash
   uvicorn app:app --reload --host 0.0.0.0 --port 80
   ```

## Docker

Build the image:
```bash
docker build -t petlistadoptions-py .
```

Run the container:
```bash
docker run -p 80:80 \
  -e APP_PET_SEARCH_URL="http://your-pet-search-service/" \
  -e APP_RDS_SECRET_ARN="arn:aws:secretsmanager:region:account:secret:your-secret" \
  petlistadoptions-py
```

## Observability

### ADOT (AWS Distro for OpenTelemetry)

The service is designed to work with ADOT for automatic instrumentation:

- **Automatic Tracing**: ADOT will automatically instrument FastAPI, requests, and psycopg2
- **Metrics Collection**: Prometheus metrics are exposed at `/metrics`
- **Logging**: Structured logging with correlation IDs
- **AWS Integration**: Automatic X-Ray trace correlation

### Metrics

The service exposes Prometheus metrics:
- `petlistadoptions_requests_total`: Request count by endpoint and error status
- `petlistadoptions_requests_latency_seconds`: Request duration by endpoint and error status

## Architecture

The service follows a clean architecture pattern:

- **Config**: Manages configuration from environment variables and AWS Parameter Store
- **Repository**: Handles database operations with PostgreSQL
- **PetSearchService**: Calls external pet search service
- **AdoptionService**: Main business logic combining database and external service calls
- **FastAPI App**: HTTP server with automatic documentation

## Database Schema

The service expects a PostgreSQL database with a `transactions` table:

```sql
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    pet_id VARCHAR(255) NOT NULL,
    transaction_id VARCHAR(255) NOT NULL,
    adoption_date TIMESTAMP
);
```

## API Documentation

Once the service is running, you can access:

- **Swagger UI**: `http://localhost:80/docs`
- **ReDoc**: `http://localhost:80/redoc`

These provide interactive documentation with the ability to test endpoints directly from the browser.

## Performance

FastAPI provides excellent performance with:
- Async/await support for concurrent operations
- Automatic request/response validation with Pydantic
- High-performance JSON serialization
- Built-in dependency injection
- Automatic OpenAPI schema generation 