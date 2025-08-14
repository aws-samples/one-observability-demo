# Testing Guide for petfood-rs

This document describes the comprehensive test suite for the petfood-rs microservice, including unit tests, integration tests, end-to-end tests, property-based tests, and load testing benchmarks.

## Test Structure

The test suite is organized into several categories:

### 1. Unit Tests
- **Location**: Embedded in source files with `#[cfg(test)]` modules
- **Purpose**: Test individual functions and methods in isolation
- **Coverage**: All services, repositories, handlers, and utility functions
- **Dependencies**: Uses `mockall` for mocking external dependencies

### 2. Integration Tests
- **Location**: `tests/integration_tests.rs`
- **Purpose**: Test API endpoints with real HTTP requests
- **Dependencies**: Uses `testcontainers` for DynamoDB, `reqwest` for HTTP client
- **Coverage**: All REST API endpoints, error handling, data persistence

### 3. End-to-End Tests
- **Location**: `tests/e2e_tests.rs`
- **Purpose**: Test complete user workflows and scenarios
- **Coverage**: User journeys, concurrent operations, error recovery

### 4. Property-Based Tests
- **Location**: `tests/property_tests.rs`
- **Purpose**: Test data validation logic with generated inputs
- **Dependencies**: Uses `proptest` for property-based testing
- **Coverage**: Input validation, serialization, business logic invariants

### 5. Load Testing Benchmarks
- **Location**: `benches/food_search.rs`, `benches/recommendations.rs`
- **Purpose**: Performance testing of critical paths
- **Dependencies**: Uses `criterion` for benchmarking
- **Coverage**: Food search operations, recommendation algorithms

## Running Tests

### Prerequisites

1. **Rust toolchain** (1.75 or later)
2. **Docker** (for integration tests with LocalStack)
3. **AWS CLI** (optional, for real AWS testing)

### Quick Start

```bash
# Run all unit tests
cargo test --lib

# Run specific test category
cargo test --test integration_tests
cargo test --test e2e_tests
cargo test --test property_tests

# Run benchmarks
cargo bench --bench food_search
cargo bench --bench recommendations

# Run comprehensive test suite
./scripts/run_tests.sh
```

### Using Docker Compose

For a complete testing environment with LocalStack:

```bash
# Start test environment
docker-compose -f docker-compose.test.yml up --build

# Run tests in container
docker-compose -f docker-compose.test.yml run test-runner
```

## Test Configuration

### Environment Variables

- `DYNAMODB_ENDPOINT`: DynamoDB endpoint (default: AWS DynamoDB)
- `SSM_ENDPOINT`: Systems Manager endpoint (default: AWS SSM)
- `AWS_REGION`: AWS region (default: us-east-1)
- `RUST_LOG`: Log level for tests (default: error)

### Test Data

Tests use generated test data with the following characteristics:

- **Foods**: Various pet types (puppy, kitten, bunny) and food types (dry, wet, treats, supplements)
- **Prices**: Range from $0.01 to $1000.00
- **Quantities**: Range from 1 to 1000 units
- **Names**: Alphanumeric strings with spaces, 3-100 characters

## Test Categories Detail

### Unit Tests

Each module includes comprehensive unit tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockall::predicate::*;

    #[tokio::test]
    async fn test_service_method() {
        // Arrange
        let mut mock_repo = MockRepository::new();
        mock_repo.expect_method()
            .with(eq(expected_input))
            .returning(|_| Ok(expected_output));

        // Act
        let result = service.method(input).await;

        // Assert
        assert!(result.is_ok());
    }
}
```

### Integration Tests

Integration tests use real HTTP requests against a test server:

```rust
#[tokio::test]
async fn test_api_endpoint() {
    let test_env = TestEnvironment::new().await;
    
    let response = test_env.client
        .post(&format!("{}/api/foods", test_env.base_url))
        .json(&create_request)
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status(), StatusCode::CREATED);
}
```

### Property-Based Tests

Property-based tests generate random inputs to verify invariants:

```rust
proptest! {
    #[test]
    fn test_validation_property(input in any::<String>()) {
        let result = validate_input(&input);
        
        if input.len() >= MIN_LEN && input.len() <= MAX_LEN {
            prop_assert!(result.is_ok());
        } else {
            prop_assert!(result.is_err());
        }
    }
}
```

### Benchmarks

Benchmarks measure performance of critical operations:

```rust
fn bench_operation(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    
    c.bench_function("operation_name", |b| {
        b.to_async(&rt).iter(|| async {
            black_box(expensive_operation().await)
        });
    });
}
```

## Performance Targets

The following performance targets are validated by benchmarks:

- **Food Search**: < 100ms for 1000 items
- **Recommendations**: < 50ms for 100 items per pet type
- **Single Food Lookup**: < 10ms
- **Cart Operations**: < 20ms per operation

## Test Data Management

### Test Environment Setup

The `TestEnvironment` struct provides:

- Isolated DynamoDB tables for each test
- HTTP client configured for test server
- Automatic cleanup after tests
- Seed data generation utilities

### Data Seeding

```rust
impl TestEnvironment {
    pub async fn seed_test_data(&self) {
        // Creates sample foods for all pet types
        // Ensures consistent test data across tests
    }
}
```

## Continuous Integration

### GitHub Actions

The test suite integrates with CI/CD pipelines:

```yaml
- name: Run Tests
  run: |
    cargo test --lib
    cargo test --test property_tests
    
- name: Run Integration Tests
  run: |
    docker-compose -f docker-compose.test.yml up -d localstack
    cargo test --test integration_tests
    cargo test --test e2e_tests
```

### Test Coverage

Coverage reports are generated using `cargo-tarpaulin`:

```bash
cargo tarpaulin --out Html --output-dir target/coverage
```

Target coverage: > 80% for all modules

## Troubleshooting

### Common Issues

1. **DynamoDB Connection Errors**
   - Ensure LocalStack is running
   - Check endpoint configuration
   - Verify AWS credentials (for real AWS)

2. **Test Timeouts**
   - Increase timeout values in test configuration
   - Check system resources
   - Verify network connectivity

3. **Flaky Tests**
   - Add proper wait conditions
   - Use deterministic test data
   - Implement retry mechanisms

### Debug Mode

Enable debug logging for tests:

```bash
RUST_LOG=debug cargo test --test integration_tests
```

## Best Practices

1. **Test Isolation**: Each test should be independent
2. **Deterministic Data**: Use fixed seeds for random data
3. **Resource Cleanup**: Always clean up test resources
4. **Error Testing**: Test both success and failure paths
5. **Performance Monitoring**: Track benchmark results over time

## Contributing

When adding new features:

1. Add unit tests for all new functions
2. Add integration tests for new API endpoints
3. Update property-based tests for new validation logic
4. Add benchmarks for performance-critical code
5. Update this documentation

## Test Metrics

The test suite tracks the following metrics:

- **Test Count**: Total number of tests
- **Coverage**: Code coverage percentage
- **Performance**: Benchmark results
- **Reliability**: Test success rate
- **Duration**: Total test execution time

These metrics help ensure the quality and maintainability of the codebase.