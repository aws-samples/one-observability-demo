use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, put},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{error, info, instrument};

use crate::models::{
    AddCartItemRequest, CartItemResponse, CartResponse, FoodFilters, FoodListApiResponse,
    FoodResponse, ServiceError, UpdateCartItemRequest,
};
use crate::services::{CartService, FoodService};

/// Shared application state containing all services
#[derive(Clone)]
pub struct ApiState {
    pub food_service: Arc<FoodService>,
    pub cart_service: Arc<CartService>,
    pub assets_cdn_url: String,
}

/// Query parameters for listing foods
#[derive(Debug, Deserialize)]
pub struct ListFoodsQuery {
    #[serde(alias = "pettype")]
    pub pet_type: Option<String>,
    #[serde(alias = "foodtype")]
    pub food_type: Option<String>,
    pub availability_status: Option<String>,
    pub min_price: Option<rust_decimal::Decimal>,
    pub max_price: Option<rust_decimal::Decimal>,
    pub search: Option<String>,
    pub in_stock_only: Option<bool>,
}

/// Response for cart validation
#[derive(Debug, Serialize)]
pub struct CartValidationResponse {
    pub is_valid: bool,
    pub issues: Vec<String>,
}

/// Create API router with all endpoints
pub fn create_api_router(
    food_service: Arc<FoodService>,
    cart_service: Arc<CartService>,
    assets_cdn_url: String,
) -> Router {
    let state = ApiState {
        food_service,
        cart_service,
        assets_cdn_url,
    };

    Router::new()
        // Food browsing endpoints (read-only)
        .route("/api/foods", get(list_foods))
        .route("/api/foods/:food_id", get(get_food))
        // Cart management endpoints
        .route("/api/cart/:user_id", get(get_cart).delete(delete_cart))
        .route("/api/cart/:user_id/items", post(add_cart_item))
        .route(
            "/api/cart/:user_id/items/:food_id",
            put(update_cart_item).delete(remove_cart_item),
        )
        .route("/api/cart/:user_id/clear", post(clear_cart))
        .route("/api/cart/:user_id/checkout", post(checkout_cart))
        .with_state(state)
}

// =============================================================================
// FOOD ENDPOINTS
// =============================================================================

/// List all foods with optional filters
#[instrument(name = "list_foods", skip(state), fields(
    pet_type = query.pet_type.as_deref(),
    food_type = query.food_type.as_deref(),
    search = query.search.as_deref(),
))]
pub async fn list_foods(
    State(state): State<ApiState>,
    Query(query): Query<ListFoodsQuery>,
) -> Result<Json<FoodListApiResponse>, (StatusCode, Json<Value>)> {
    info!("Listing foods with filters");

    // Convert query parameters to filters
    let filters = match query_to_filters(query) {
        Ok(filters) => filters,
        Err(err) => {
            error!("Invalid query parameters: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid query parameters",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    match state.food_service.list_foods(filters).await {
        Ok(response) => {
            info!("Successfully listed {} foods", response.total_count);

            // Convert Food to FoodResponse with full image URLs
            let food_responses: Vec<FoodResponse> = response
                .foods
                .iter()
                .map(|food| food.to_response(&state.assets_cdn_url))
                .collect();

            let response_with_urls = FoodListApiResponse {
                foods: food_responses,
                total_count: response.total_count,
                page: response.page,
                page_size: response.page_size,
            };

            Ok(Json(response_with_urls))
        }
        Err(err) => {
            error!("Failed to list foods: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get a specific food by ID
#[instrument(name = "get_food", skip(state), fields(food_id = %food_id))]
pub async fn get_food(
    State(state): State<ApiState>,
    Path(food_id): Path<String>,
) -> Result<Json<FoodResponse>, (StatusCode, Json<Value>)> {
    info!("Getting food with ID: {}", food_id);

    match state.food_service.get_food(&food_id).await {
        Ok(food) => {
            info!("Successfully retrieved food: {}", food.name);
            let food_response = food.to_response(&state.assets_cdn_url);
            Ok(Json(food_response))
        }
        Err(err) => {
            error!("Failed to get food {}: {}", food_id, err);
            Err(service_error_to_response(err))
        }
    }
}

// =============================================================================
// CART ENDPOINTS
// =============================================================================

/// Get a user's cart
#[instrument(name = "get_cart", skip(state), fields(user_id = %user_id))]
pub async fn get_cart(
    State(state): State<ApiState>,
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
#[instrument(name = "add_cart_item", skip(state, request), fields(
    user_id = %user_id,
    food_id = %request.food_id,
    quantity = %request.quantity,
))]
pub async fn add_cart_item(
    State(state): State<ApiState>,
    Path(user_id): Path<String>,
    Json(request): Json<AddCartItemRequest>,
) -> Result<(StatusCode, Json<CartItemResponse>), (StatusCode, Json<Value>)> {
    crate::info_with_trace!(
        "Adding item to cart for user: {}, food_id: {}, quantity: {}",
        user_id, request.food_id, request.quantity
    );

    match state.cart_service.add_item(&user_id, request).await {
        Ok(item) => {
            crate::info_with_trace!("Successfully added item to cart");
            Ok((StatusCode::CREATED, Json(item)))
        }
        Err(err) => {
            crate::error_with_trace!("Failed to add item to cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Update the quantity of an item in the cart
#[instrument(name = "update_cart_item", skip(state, request), fields(
    user_id = %user_id,
    food_id = %food_id,
    quantity = %request.quantity,
))]
pub async fn update_cart_item(
    State(state): State<ApiState>,
    Path((user_id, food_id)): Path<(String, String)>,
    Json(request): Json<UpdateCartItemRequest>,
) -> Result<Json<CartItemResponse>, (StatusCode, Json<Value>)> {
    crate::info_with_trace!(
        "Updating cart item for user: {}, food_id: {}, new_quantity: {}",
        user_id, food_id, request.quantity
    );

    match state
        .cart_service
        .update_item(&user_id, &food_id, request)
        .await
    {
        Ok(item) => {
            crate::info_with_trace!("Successfully updated cart item");
            Ok(Json(item))
        }
        Err(err) => {
            crate::error_with_trace!("Failed to update cart item: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Remove an item from the cart
#[instrument(name = "remove_cart_item", skip(state), fields(
    user_id = %user_id,
    food_id = %food_id,
))]
pub async fn remove_cart_item(
    State(state): State<ApiState>,
    Path((user_id, food_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    crate::info_with_trace!(
        "Removing item from cart for user: {}, food_id: {}",
        user_id, food_id
    );

    match state.cart_service.remove_item(&user_id, &food_id).await {
        Ok(()) => {
            crate::info_with_trace!("Successfully removed item from cart");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(err) => {
            crate::error_with_trace!("Failed to remove item from cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Clear all items from the cart
#[instrument(name = "clear_cart", skip(state), fields(
    user_id = %user_id,
))]
pub async fn clear_cart(
    State(state): State<ApiState>,
    Path(user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    crate::info_with_trace!("Clearing cart for user: {}", user_id);

    match state.cart_service.clear_cart(&user_id).await {
        Ok(()) => {
            crate::info_with_trace!("Successfully cleared cart");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(err) => {
            crate::error_with_trace!("Failed to clear cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Delete the entire cart
#[instrument(name = "delete_cart", skip(state), fields(
    user_id = %user_id,
))]
pub async fn delete_cart(
    State(state): State<ApiState>,
    Path(user_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    crate::info_with_trace!("Deleting cart for user: {}", user_id);

    match state.cart_service.delete_cart(&user_id).await {
        Ok(()) => {
            crate::info_with_trace!("Successfully deleted cart");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(err) => {
            crate::error_with_trace!("Failed to delete cart: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Checkout cart and create order
#[instrument(name = "checkout_cart", skip(state, request), fields(
    user_id = %user_id,
    has_shipping_address = request.shipping_address.is_some(),
    has_billing_address = request.billing_address.is_some(),
))]
pub async fn checkout_cart(
    State(state): State<ApiState>,
    Path(user_id): Path<String>,
    Json(request): Json<crate::models::CheckoutRequest>,
) -> Result<Json<crate::models::CheckoutResponse>, (StatusCode, Json<Value>)> {
    info!("Processing checkout for user: {}", user_id);

    match state.cart_service.checkout(&user_id, request).await {
        Ok(checkout_response) => {
            crate::info_with_trace!(
                "Checkout completed successfully for order: {}",
                checkout_response.order_id
            );
            Ok(Json(checkout_response))
        }
        Err(err) => {
            crate::error_with_trace!("Failed to process checkout: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Convert query parameters to FoodFilters
fn query_to_filters(query: ListFoodsQuery) -> Result<FoodFilters, String> {
    let mut filters = FoodFilters::default();

    // Parse pet type
    if let Some(pet_type_str) = query.pet_type {
        filters.pet_type = Some(
            pet_type_str
                .parse()
                .map_err(|e| format!("Invalid pet_type: {}", e))?,
        );
    }

    // Parse food type
    if let Some(food_type_str) = query.food_type {
        filters.food_type = Some(
            food_type_str
                .parse()
                .map_err(|e| format!("Invalid food_type: {}", e))?,
        );
    }

    // Parse availability status
    if let Some(status_str) = query.availability_status {
        filters.availability_status = Some(
            status_str
                .parse()
                .map_err(|e| format!("Invalid availability_status: {}", e))?,
        );
    }

    // Set price filters
    filters.min_price = query.min_price;
    filters.max_price = query.max_price;

    // Set search term
    filters.search_term = query.search;

    // Set in stock only filter
    filters.in_stock_only = query.in_stock_only;

    Ok(filters)
}

/// Convert ServiceError to HTTP response
fn service_error_to_response(err: ServiceError) -> (StatusCode, Json<Value>) {
    let (status, message) = match err {
        ServiceError::FoodNotFound { .. } => (StatusCode::NOT_FOUND, err.to_string()),
        ServiceError::CartNotFound { .. } => (StatusCode::NOT_FOUND, err.to_string()),
        ServiceError::CartItemNotFound { .. } => (StatusCode::NOT_FOUND, err.to_string()),
        ServiceError::ValidationError { .. } => (StatusCode::BAD_REQUEST, err.to_string()),
        ServiceError::InvalidPetType { .. } => (StatusCode::BAD_REQUEST, err.to_string()),
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
    use crate::models::{FoodType, PetType};

    #[test]
    fn test_query_to_filters() {
        let query = ListFoodsQuery {
            pet_type: Some("puppy".to_string()),
            food_type: Some("dry".to_string()),
            availability_status: Some("in_stock".to_string()),
            min_price: Some(rust_decimal_macros::dec!(5.00)),
            max_price: Some(rust_decimal_macros::dec!(20.00)),
            search: Some("kibble".to_string()),
            in_stock_only: Some(true),
        };

        let filters = query_to_filters(query).unwrap();

        assert_eq!(filters.pet_type, Some(PetType::Puppy));
        assert_eq!(filters.food_type, Some(FoodType::Dry));
        assert_eq!(filters.min_price, Some(rust_decimal_macros::dec!(5.00)));
        assert_eq!(filters.max_price, Some(rust_decimal_macros::dec!(20.00)));
        assert_eq!(filters.search_term, Some("kibble".to_string()));
        assert_eq!(filters.in_stock_only, Some(true));
    }
}
