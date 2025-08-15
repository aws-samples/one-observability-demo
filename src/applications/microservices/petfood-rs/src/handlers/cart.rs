use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, put},
    Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{error, info, instrument};

use crate::models::{
    AddCartItemRequest, CartItemResponse, CartResponse, ServiceError, UpdateCartItemRequest,
};
use crate::services::CartService;

/// Response for cart validation
#[derive(Debug, Serialize)]
pub struct CartValidationResponse {
    pub is_valid: bool,
    pub issues: Vec<String>,
}

/// Response for cart summary operations
#[derive(Debug, Serialize)]
pub struct CartSummaryResponse {
    pub user_id: String,
    pub total_items: u32,
    pub total_price: rust_decimal::Decimal,
    pub is_empty: bool,
}

/// State for cart handlers
#[derive(Clone)]
pub struct CartHandlerState {
    pub cart_service: Arc<CartService>,
}

/// Create cart router with all endpoints
pub fn create_cart_router(cart_service: Arc<CartService>) -> Router {
    let state = CartHandlerState { cart_service };

    Router::new()
        .route("/api/cart/:user_id", get(get_cart).delete(delete_cart))
        .route("/api/cart/:user_id/items", post(add_cart_item))
        .route(
            "/api/cart/:user_id/items/:food_id",
            put(update_cart_item).delete(remove_cart_item),
        )
        .route("/api/cart/:user_id/clear", post(clear_cart))
        .route("/api/cart/:user_id/summary", get(get_cart_summary))
        .route("/api/cart/:user_id/validate", get(validate_cart))
        .with_state(state)
}

/// Get a user's cart
#[instrument(skip(state))]
pub async fn get_cart(
    State(state): State<CartHandlerState>,
    Path(user_id): Path<String>,
) -> Result<Json<CartResponse>, (StatusCode, Json<Value>)> {
    info!("Getting cart for user: {}", user_id);

    match state.cart_service.get_cart(&user_id).await {
        Ok(cart) => {
            info!(
                "Successfully retrieved cart with {} items",
                cart.total_items
            );
            Ok(Json(cart))
        }
        Err(err) => {
            error!("Failed to get cart for user {}: {}", user_id, err);
            Err(service_error_to_response(err))
        }
    }
}

/// Add an item to the cart
#[instrument(skip(state, request))]
pub async fn add_cart_item(
    State(state): State<CartHandlerState>,
    Path(user_id): Path<String>,
    Json(request): Json<AddCartItemRequest>,
) -> Result<(StatusCode, Json<CartItemResponse>), (StatusCode, Json<Value>)> {
    info!(
        "Adding item to cart for user: {}, food_id: {}, quantity: {}",
        user_id, request.food_id, request.quantity
    );

    match state.cart_service.add_item(&user_id, request).await {
        Ok(item) => {
            info!("Successfully added item to cart");
            Ok((StatusCode::CREATED, Json(item)))
        }
        Err(err) => {
            error!("Failed to add item to cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Update the quantity of an item in the cart
#[instrument(skip(state, request))]
pub async fn update_cart_item(
    State(state): State<CartHandlerState>,
    Path((user_id, food_id)): Path<(String, String)>,
    Json(request): Json<UpdateCartItemRequest>,
) -> Result<Json<CartItemResponse>, (StatusCode, Json<Value>)> {
    info!(
        "Updating cart item for user: {}, food_id: {}, new_quantity: {}",
        user_id, food_id, request.quantity
    );

    match state
        .cart_service
        .update_item(&user_id, &food_id, request)
        .await
    {
        Ok(item) => {
            info!("Successfully updated cart item");
            Ok(Json(item))
        }
        Err(err) => {
            error!("Failed to update cart item: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Remove an item from the cart
#[instrument(skip(state))]
pub async fn remove_cart_item(
    State(state): State<CartHandlerState>,
    Path((user_id, food_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    info!(
        "Removing item from cart for user: {}, food_id: {}",
        user_id, food_id
    );

    match state.cart_service.remove_item(&user_id, &food_id).await {
        Ok(()) => {
            info!("Successfully removed item from cart");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(err) => {
            error!("Failed to remove item from cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Clear all items from the cart
#[instrument(skip(state))]
pub async fn clear_cart(
    State(state): State<CartHandlerState>,
    Path(user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    info!("Clearing cart for user: {}", user_id);

    match state.cart_service.clear_cart(&user_id).await {
        Ok(()) => {
            info!("Successfully cleared cart");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(err) => {
            error!("Failed to clear cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Delete the entire cart
#[instrument(skip(state))]
pub async fn delete_cart(
    State(state): State<CartHandlerState>,
    Path(user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    info!("Deleting cart for user: {}", user_id);

    match state.cart_service.delete_cart(&user_id).await {
        Ok(()) => {
            info!("Successfully deleted cart");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(err) => {
            error!("Failed to delete cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get cart summary (total items, price, etc.)
#[instrument(skip(state))]
pub async fn get_cart_summary(
    State(state): State<CartHandlerState>,
    Path(user_id): Path<String>,
) -> Result<Json<CartSummaryResponse>, (StatusCode, Json<Value>)> {
    info!("Getting cart summary for user: {}", user_id);

    // Get cart details
    let cart = match state.cart_service.get_cart(&user_id).await {
        Ok(cart) => cart,
        Err(err) => {
            error!("Failed to get cart for summary: {}", err);
            return Err(service_error_to_response(err));
        }
    };

    let summary = CartSummaryResponse {
        user_id: cart.user_id,
        total_items: cart.total_items,
        total_price: cart.total_price,
        is_empty: cart.total_items == 0,
    };

    info!("Successfully retrieved cart summary");
    Ok(Json(summary))
}

/// Validate cart contents (check availability and stock)
#[instrument(skip(state))]
pub async fn validate_cart(
    State(state): State<CartHandlerState>,
    Path(user_id): Path<String>,
) -> Result<Json<CartValidationResponse>, (StatusCode, Json<Value>)> {
    info!("Validating cart for user: {}", user_id);

    match state.cart_service.validate_cart(&user_id).await {
        Ok(issues) => {
            let is_valid = issues.is_empty();
            info!(
                "Cart validation completed: valid={}, issues={}",
                is_valid,
                issues.len()
            );

            Ok(Json(CartValidationResponse { is_valid, issues }))
        }
        Err(err) => {
            error!("Failed to validate cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Convert ServiceError to HTTP response
fn service_error_to_response(err: ServiceError) -> (StatusCode, Json<Value>) {
    let (status, message) = match err {
        ServiceError::FoodNotFound { .. } => (StatusCode::NOT_FOUND, err.to_string()),
        ServiceError::CartNotFound { .. } => (StatusCode::NOT_FOUND, err.to_string()),
        ServiceError::CartItemNotFound { .. } => (StatusCode::NOT_FOUND, err.to_string()),
        ServiceError::ValidationError { .. } => (StatusCode::BAD_REQUEST, err.to_string()),
        ServiceError::InvalidQuantity { .. } => (StatusCode::BAD_REQUEST, err.to_string()),
        ServiceError::InsufficientStock { .. } => (StatusCode::CONFLICT, err.to_string()),
        ServiceError::ProductUnavailable { .. } => (StatusCode::CONFLICT, err.to_string()),
        ServiceError::Repository { source } => match source {
            crate::models::RepositoryError::NotFound => {
                (StatusCode::NOT_FOUND, "Resource not found".to_string())
            }
            crate::models::RepositoryError::ConnectionFailed => (
                StatusCode::SERVICE_UNAVAILABLE,
                "Database connection failed".to_string(),
            ),
            crate::models::RepositoryError::Timeout => {
                (StatusCode::REQUEST_TIMEOUT, "Request timeout".to_string())
            }
            crate::models::RepositoryError::RateLimitExceeded => (
                StatusCode::TOO_MANY_REQUESTS,
                "Rate limit exceeded".to_string(),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            ),
        },
        ServiceError::Configuration { .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Configuration error".to_string(),
        ),
        ServiceError::ExternalService { .. } => (
            StatusCode::BAD_GATEWAY,
            "External service error".to_string(),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal server error".to_string(),
        ),
    };

    (
        status,
        Json(json!({
            "error": message,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cart_validation_response_serialization() {
        let response = CartValidationResponse {
            is_valid: false,
            issues: vec!["Product out of stock".to_string()],
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("is_valid"));
        assert!(json.contains("issues"));
        assert!(json.contains("Product out of stock"));
    }

    #[test]
    fn test_cart_summary_response_serialization() {
        let response = CartSummaryResponse {
            user_id: "user123".to_string(),
            total_items: 5,
            total_price: rust_decimal_macros::dec!(49.95),
            is_empty: false,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("user123"));
        assert!(json.contains("total_items"));
        assert!(json.contains("total_price"));
        assert!(json.contains("is_empty"));
    }

    #[test]
    fn test_add_cart_item_request_deserialization() {
        let json = r#"{"food_id": "F001", "quantity": 3}"#;
        let request: AddCartItemRequest = serde_json::from_str(json).unwrap();

        assert_eq!(request.food_id, "F001");
        assert_eq!(request.quantity, 3);
    }

    #[test]
    fn test_update_cart_item_request_deserialization() {
        let json = r#"{"quantity": 5}"#;
        let request: UpdateCartItemRequest = serde_json::from_str(json).unwrap();

        assert_eq!(request.quantity, 5);
    }
}
