use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{error, info, instrument};

use crate::models::{
    CreateFoodRequest, FoodFilters, FoodListResponse, ServiceError, UpdateFoodRequest, Food,
};
use crate::services::FoodService;

/// Query parameters for listing foods
#[derive(Debug, Deserialize)]
pub struct ListFoodsQuery {
    pub pet_type: Option<String>,
    pub food_type: Option<String>,
    pub availability_status: Option<String>,
    pub min_price: Option<rust_decimal::Decimal>,
    pub max_price: Option<rust_decimal::Decimal>,
    pub search: Option<String>,
    pub in_stock_only: Option<bool>,
}

/// State for food handlers
#[derive(Clone)]
pub struct FoodHandlerState {
    pub food_service: Arc<FoodService>,
}

/// List all foods with optional filters
#[instrument(skip(state))]
pub async fn list_foods(
    State(state): State<FoodHandlerState>,
    Query(query): Query<ListFoodsQuery>,
) -> Result<Json<FoodListResponse>, (StatusCode, Json<Value>)> {
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
            Ok(Json(response))
        }
        Err(err) => {
            error!("Failed to list foods: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get a specific food by ID
#[instrument(skip(state))]
pub async fn get_food(
    State(state): State<FoodHandlerState>,
    Path(food_id): Path<String>,
) -> Result<Json<Food>, (StatusCode, Json<Value>)> {
    info!("Getting food with ID: {}", food_id);

    match state.food_service.get_food(&food_id).await {
        Ok(food) => {
            info!("Successfully retrieved food: {}", food.name);
            Ok(Json(food))
        }
        Err(err) => {
            error!("Failed to get food {}: {}", food_id, err);
            Err(service_error_to_response(err))
        }
    }
}

/// Create a new food product
#[instrument(skip(state, request))]
pub async fn create_food(
    State(state): State<FoodHandlerState>,
    Json(request): Json<CreateFoodRequest>,
) -> Result<(StatusCode, Json<Food>), (StatusCode, Json<Value>)> {
    info!("Creating new food: {}", request.name);

    match state.food_service.create_food(request).await {
        Ok(food) => {
            info!("Successfully created food with ID: {}", food.id);
            Ok((StatusCode::CREATED, Json(food)))
        }
        Err(err) => {
            error!("Failed to create food: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Update an existing food product
#[instrument(skip(state, request))]
pub async fn update_food(
    State(state): State<FoodHandlerState>,
    Path(food_id): Path<String>,
    Json(request): Json<UpdateFoodRequest>,
) -> Result<Json<Food>, (StatusCode, Json<Value>)> {
    info!("Updating food with ID: {}", food_id);

    match state.food_service.update_food(&food_id, request).await {
        Ok(food) => {
            info!("Successfully updated food: {}", food.name);
            Ok(Json(food))
        }
        Err(err) => {
            error!("Failed to update food {}: {}", food_id, err);
            Err(service_error_to_response(err))
        }
    }
}

/// Soft delete a food product
#[instrument(skip(state))]
pub async fn delete_food(
    State(state): State<FoodHandlerState>,
    Path(food_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    info!("Deleting food with ID: {}", food_id);

    match state.food_service.delete_food(&food_id).await {
        Ok(()) => {
            info!("Successfully deleted food: {}", food_id);
            Ok(StatusCode::NO_CONTENT)
        }
        Err(err) => {
            error!("Failed to delete food {}: {}", food_id, err);
            Err(service_error_to_response(err))
        }
    }
}

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
        ServiceError::ValidationError { .. } => (StatusCode::BAD_REQUEST, err.to_string()),
        ServiceError::InvalidPetType { .. } => (StatusCode::BAD_REQUEST, err.to_string()),
        ServiceError::Repository { source } => match source {
            crate::models::RepositoryError::NotFound => {
                (StatusCode::NOT_FOUND, "Resource not found".to_string())
            }
            crate::models::RepositoryError::ConnectionFailed => {
                (StatusCode::SERVICE_UNAVAILABLE, "Database connection failed".to_string())
            }
            crate::models::RepositoryError::Timeout => {
                (StatusCode::REQUEST_TIMEOUT, "Request timeout".to_string())
            }
            crate::models::RepositoryError::RateLimitExceeded => {
                (StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded".to_string())
            }
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string()),
        },
        ServiceError::Configuration { .. } => {
            (StatusCode::INTERNAL_SERVER_ERROR, "Configuration error".to_string())
        }
        ServiceError::ExternalService { .. } => {
            (StatusCode::BAD_GATEWAY, "External service error".to_string())
        }
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string()),
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

    #[test]
    fn test_query_to_filters_invalid_pet_type() {
        let query = ListFoodsQuery {
            pet_type: Some("invalid".to_string()),
            food_type: None,
            availability_status: None,
            min_price: None,
            max_price: None,
            search: None,
            in_stock_only: None,
        };

        let result = query_to_filters(query);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid pet_type"));
    }

    #[test]
    fn test_empty_query_to_filters() {
        let query = ListFoodsQuery {
            pet_type: None,
            food_type: None,
            availability_status: None,
            min_price: None,
            max_price: None,
            search: None,
            in_stock_only: None,
        };

        let filters = query_to_filters(query).unwrap();
        assert_eq!(filters, FoodFilters::default());
    }
}