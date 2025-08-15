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

- `PETFOOD_SERVER_HOST`: Server host (default: 0.0.0.0)
- `PETFOOD_SERVER_PORT`: Server port (default: 80)
- `PETFOOD_SERVER_REQUEST_TIMEOUT_SECONDS`: Request timeout (default: 30)

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