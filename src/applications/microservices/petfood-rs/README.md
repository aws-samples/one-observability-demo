# Pet Food Microservice (Rust)

A Rust-based microservice for managing pet food and consumable products within the Pet Adoptions workshop ecosystem.

## Overview

This service provides:
- Pet food catalog management
- Product recommendations based on pet type
- Shopping cart functionality
- Integration with existing observability stack

## Technology Stack

- **Language**: Rust
- **Web Framework**: Axum
- **Database**: DynamoDB
- **Observability**: OpenTelemetry + Prometheus
- **Deployment**: ECS Fargate

## Observability Architecture

This service implements a comprehensive observability system that provides automatic request tracing, metrics collection, and distributed tracing for every HTTP request. The system is built using Rust's `tracing` ecosystem, Prometheus metrics, and OpenTelemetry for distributed tracing.

### Core Components

#### 1. Observability Middleware

The main middleware function (`observability_middleware`) wraps every HTTP request and provides:

- **Automatic Request Tracing**: Each request gets a unique ID and structured logging
- **Metrics Collection**: HTTP request metrics, duration histograms, and in-flight request tracking
- **Distributed Tracing**: Integration with AWS X-Ray through OpenTelemetry
- **Error Tracking**: Automatic error logging and metrics for failed requests

**Request Flow:**
```
1. Request arrives → Observability middleware intercepts
2. Create endpoint-specific tracing span and extract OpenTelemetry span ID
3. Record start time and increment in-flight metrics
4. Process request through handlers (with automatic tracing)
5. Record final metrics (status, duration) and complete span
6. Send trace data to AWS X-Ray for visualization
```

#### 2. Metrics System

Uses **Prometheus** to collect various types of metrics:

**HTTP Metrics:**
- `http_requests_total` - Total requests by method, endpoint, status code
- `http_request_duration_seconds` - Request duration histograms with percentiles
- `http_requests_in_flight` - Current concurrent requests

**Database Metrics:**
- `database_operations_total` - Database operations by type, table, status
- `database_operation_duration_seconds` - Database query performance
- `database_connections_active` - Active connection pool size

**Business Logic Metrics:**
- `food_operations_total` - Food searches by pet type, food type, status
- `cart_operations_total` - Cart operations (add, update, remove, checkout)
- `recommendation_requests_total` - Recommendation requests by pet type

**System Metrics:**
- `memory_usage_bytes` - Current memory usage
- `cpu_usage_percent` - Current CPU utilization

#### 3. Distributed Tracing

Integrates with **OpenTelemetry** and **AWS X-Ray**:

- **Service Metadata**: Automatic service name, version, and namespace tagging
- **Span Correlation**: Links HTTP requests to database operations and business logic
- **Sampling**: Configurable sampling rates for production environments
- **Batching**: Efficient batch export to reduce overhead

**Example Trace Structure:**
```
Trace ID: abc123...
├── Span: GET /api/foods
│   ├── span_id: 1a2b3c4d5e6f7890
│   ├── method: GET
│   ├── uri: /api/foods?pettype=puppy
│   ├── user_agent: Mozilla/5.0...
│   └── Span: list_foods
│       ├── pet_type: puppy
│       └── Span: find_by_pet_type
│           ├── operation: query
│           ├── table: PetFoods
│           ├── index: PetTypeIndex
│           └── duration: 45ms
```

#### 4. Automatic Instrumentation

Throughout the codebase, functions are automatically instrumented using the `#[instrument]` macro:

```rust
#[instrument(skip(state))]
pub async fn list_foods(
    State(state): State<ApiState>,
    Query(query): Query<ListFoodsQuery>,
) -> Result<Json<FoodListResponse>, (StatusCode, Json<Value>)>
```

This automatically:
- Creates child spans for each function call
- Captures function parameters (except sensitive data)
- Tracks function execution time
- Propagates trace context across async boundaries

#### 5. Specialized Tracing Middleware

**Database Tracing:**
- Wraps all database operations with performance tracking
- Records success/failure rates and latency metrics
- Correlates database operations with HTTP requests

**Business Logic Tracing:**
- Tracks food search patterns and performance
- Monitors cart operation success rates
- Records recommendation request analytics

### Configuration

Observability behavior is controlled through environment variables:

```bash
# Logging Configuration
ENABLE_JSON_LOGGING=true          # Use structured JSON logs (production)
RUST_LOG=info                     # Log level filtering

# OpenTelemetry Configuration
PETFOOD_OTLP_ENDPOINT=http://localhost:4317  # OpenTelemetry collector endpoint

# Service Metadata
PETFOOD_SERVICE_NAME=petfood-service         # Service name for tracing
PETFOOD_SERVICE_VERSION=1.0.0                # Service version
```

### Monitoring Endpoints

- **Health Check**: `GET /health/status` - Service health status
- **Metrics**: `GET /metrics` - Prometheus metrics for scraping
- **Admin**: `GET /admin/health` - Detailed health information

### Benefits

1. **Automatic Observability**: Every request is traced without manual instrumentation
2. **Performance Monitoring**: Real-time performance metrics and alerting
3. **Distributed Tracing**: Full request traces across service boundaries
4. **Business Intelligence**: Pet food search patterns and cart analytics
5. **Operational Insights**: Error tracking, capacity planning, and performance optimization

### Integration with AWS

- **CloudWatch X-Ray**: Distributed tracing visualization
- **CloudWatch Metrics**: Custom metrics and alarms
- **CloudWatch Logs**: Structured logging with correlation IDs
- **Application Signals**: Automatic SLI/SLO monitoring

## Getting Started

### Prerequisites

- Rust 1.75 or later
- AWS CLI configured
- Docker (for containerization)

### Local Development

1. Clone the repository
2. Navigate to the petfood-rs directory:
   ```bash
   cd PetAdoptions/petfood-rs
   ```

3. Install dependencies:
   ```bash
   cargo build
   ```

4. Run the service:
   ```bash
   cargo run
   ```

The service will start on port 80 by default.

### Configuration

The service can be configured using environment variables with the `PETFOOD_` prefix:

**Server Configuration:**
- `PETFOOD_SERVER_HOST`: Server host (default: 0.0.0.0)
- `PETFOOD_SERVER_PORT`: Server port (default: 80)
- `PETFOOD_SERVER_REQUEST_TIMEOUT_SECONDS`: Request timeout (default: 30)

**Database Configuration:**
- `PETFOOD_FOODS_TABLE_NAME`: DynamoDB table name for foods
- `PETFOOD_CARTS_TABLE_NAME`: DynamoDB table name for carts
- `AWS_REGION`: AWS region for DynamoDB and other services

**Observability Configuration:**
- `PETFOOD_SERVICE_NAME`: Service name for tracing (default: petfood-service)
- `PETFOOD_SERVICE_VERSION`: Service version for tracing (default: 1.0.0)
- `PETFOOD_OTLP_ENDPOINT`: OpenTelemetry collector endpoint
- `ENABLE_JSON_LOGGING`: Enable structured JSON logging (true/false)
- `RUST_LOG`: Log level filtering (debug, info, warn, error)

**Assets Configuration:**
- `PETFOOD_ASSETS_CDN_URL`: CDN base URL for food images and assets (default: https://petfood-assets.s3.amazonaws.com)

### Image URL Handling

The service uses dynamic image URL generation for flexibility in serving images:

- **Storage**: Image paths with petfood prefix are stored in the database (e.g., "petfood/beef-turkey-kibbles.jpg")
- **Response**: Full CDN URLs are dynamically generated in API responses
- **Configuration**: The CDN base URL is configurable via `PETFOOD_ASSETS_CDN_URL`
- **Benefits**: Easy switching between S3, CloudFront, or other CDN providers without database changes

Example configuration:
```bash
# For S3 direct access
export PETFOOD_ASSETS_CDN_URL="https://petfood-assets.s3.amazonaws.com"

# For CloudFront distribution (with or without trailing slash)
export PETFOOD_ASSETS_CDN_URL="https://d1234567890.cloudfront.net/images"
export PETFOOD_ASSETS_CDN_URL="https://d1234567890.cloudfront.net/images/"
```

The service automatically handles trailing slashes and combines the CDN URL with the stored path.

### Full config example

```
# Server Configuration
PETFOOD_HOST=0.0.0.0
PETFOOD_PORT=8080
PETFOOD_REQUEST_TIMEOUT_SECONDS=30

# Database Configuration
PETFOOD_FOODS_TABLE_NAME=PetFoods
PETFOOD_CARTS_TABLE_NAME=PetFoodCarts
PETFOOD_REGION=us-west-2
PETFOOD_ASSETS_CDN_URL=https://d1234567890.cloudfront.net/images

# AWS Configuration
AWS_REGION=us-west-2

# Observability Configuration
PETFOOD_SERVICE_NAME=petfood-rs
PETFOOD_SERVICE_VERSION=1.0.0
PETFOOD_OTLP_ENDPOINT=http://localhost:4317
PETFOOD_METRICS_PORT=9090
PETFOOD_LOG_LEVEL=info
PETFOOD_ENABLE_JSON_LOGGING=false
```

### Health Check

The service provides a health check endpoint at `/health/status`.

## API Endpoints

### Health
- `GET /health/status` - Health check endpoint

### Food Management (Coming Soon)
- `GET /api/foods` - List all foods
- `GET /api/foods/{food_id}` - Get specific food details
- `POST /api/foods` - Create new food (admin)
- `PUT /api/foods/{food_id}` - Update food (admin)
- `DELETE /api/foods/{food_id}` - Delete food (admin)

### Recommendations (Coming Soon)
- `GET /api/recommendations/{pet_type}` - Get recommendations for pet type

### Shopping Cart (Coming Soon)
- `GET /api/cart/{user_id}` - Get user's cart
- `POST /api/cart/{user_id}/items` - Add item to cart
- `PUT /api/cart/{user_id}/items/{food_id}` - Update cart item
- `DELETE /api/cart/{user_id}/items/{food_id}` - Remove cart item

## Development

### Running Tests

```bash
cargo test
```

### Code Formatting

```bash
cargo fmt
```

### Linting

```bash
cargo clippy
```

## Deployment

This service follows the same deployment patterns as other microservices in the Pet Adoptions workshop and will be deployed using AWS CDK to ECS Fargate.

## Contributing

This service is part of the AWS One Observability Workshop. Please follow the established patterns and conventions used by other microservices in the ecosystem.