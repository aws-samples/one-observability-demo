use thiserror::Error;

/// Service-level errors that can occur in business logic
#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("Food not found: {id}")]
    FoodNotFound { id: String },

    #[error("Invalid pet type: {pet_type}")]
    InvalidPetType { pet_type: String },

    #[error("Cart not found for user: {user_id}")]
    CartNotFound { user_id: String },

    #[error("Cart item not found: food_id={food_id}, user_id={user_id}")]
    CartItemNotFound { food_id: String, user_id: String },

    #[error("Validation error: {message}")]
    ValidationError { message: String },

    #[error("Repository error: {source}")]
    Repository {
        #[from]
        source: RepositoryError,
    },

    #[error("Configuration error: {message}")]
    Configuration { message: String },

    #[error("External service error: {service}: {message}")]
    ExternalService { service: String, message: String },

    #[error("Insufficient stock: requested={requested}, available={available}")]
    InsufficientStock { requested: u32, available: u32 },

    #[error("Invalid quantity: {quantity}")]
    InvalidQuantity { quantity: u32 },

    #[error("Product unavailable: {food_id}")]
    ProductUnavailable { food_id: String },
}

/// Repository-level errors for data access operations
#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("Database connection failed")]
    ConnectionFailed,

    #[error("Item not found")]
    NotFound,

    #[error("Constraint violation: {message}")]
    ConstraintViolation { message: String },

    #[error("Serialization error: {source}")]
    Serialization {
        #[from]
        source: serde_json::Error,
    },

    #[error("AWS SDK error: {message}")]
    AwsSdk { message: String },

    #[error("DynamoDB table not found: {table_name}. Ensure the table exists and IAM permissions are correct.")]
    TableNotFound { table_name: String },

    #[error("Invalid query parameters: {message}")]
    InvalidQuery { message: String },

    #[error("Transaction failed: {message}")]
    TransactionFailed { message: String },

    #[error("Timeout occurred during operation")]
    Timeout,

    #[error("Rate limit exceeded")]
    RateLimitExceeded,
}

/// Validation errors for input data
#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("Required field missing: {field}")]
    RequiredField { field: String },

    #[error("Invalid field value: {field}={value}, reason={reason}")]
    InvalidValue {
        field: String,
        value: String,
        reason: String,
    },

    #[error("Field too long: {field}, max_length={max_length}, actual_length={actual_length}")]
    TooLong {
        field: String,
        max_length: usize,
        actual_length: usize,
    },

    #[error("Field too short: {field}, min_length={min_length}, actual_length={actual_length}")]
    TooShort {
        field: String,
        min_length: usize,
        actual_length: usize,
    },

    #[error("Invalid format: {field}, expected={expected}")]
    InvalidFormat { field: String, expected: String },

    #[error("Value out of range: {field}, min={min}, max={max}, value={value}")]
    OutOfRange {
        field: String,
        min: String,
        max: String,
        value: String,
    },
}

impl From<ValidationError> for ServiceError {
    fn from(err: ValidationError) -> Self {
        ServiceError::ValidationError {
            message: err.to_string(),
        }
    }
}

/// Result type alias for service operations
pub type ServiceResult<T> = Result<T, ServiceError>;

/// Result type alias for repository operations
pub type RepositoryResult<T> = Result<T, RepositoryError>;

/// Result type alias for validation operations
pub type ValidationResult<T> = Result<T, ValidationError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let error = ServiceError::FoodNotFound {
            id: "F001".to_string(),
        };
        assert_eq!(error.to_string(), "Food not found: F001");

        let validation_error = ValidationError::RequiredField {
            field: "food_name".to_string(),
        };
        assert_eq!(
            validation_error.to_string(),
            "Required field missing: food_name"
        );
    }

    #[test]
    fn test_error_conversion() {
        let validation_error = ValidationError::InvalidValue {
            field: "price".to_string(),
            value: "-10".to_string(),
            reason: "Price cannot be negative".to_string(),
        };

        let service_error: ServiceError = validation_error.into();
        match service_error {
            ServiceError::ValidationError { message } => {
                assert!(message.contains("Invalid field value"));
            }
            _ => panic!("Expected ValidationError conversion"),
        }
    }

    #[test]
    fn test_repository_error_from_serde() {
        let json_error = serde_json::from_str::<serde_json::Value>("invalid json");
        assert!(json_error.is_err());

        let repo_error: RepositoryError = json_error.unwrap_err().into();
        match repo_error {
            RepositoryError::Serialization { .. } => {}
            _ => panic!("Expected Serialization error"),
        }
    }
}
