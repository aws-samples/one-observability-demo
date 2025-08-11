use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{error, info, instrument};

use crate::models::{Food, PetType, FoodType, ServiceError};
use crate::services::{RecommendationService, RecommendationStats};

/// Query parameters for recommendation requests
#[derive(Debug, Deserialize)]
pub struct RecommendationQuery {
    pub food_type: Option<String>,
    pub max_price: Option<rust_decimal::Decimal>,
    pub limit: Option<usize>,
}

/// Query parameters for budget recommendations
#[derive(Debug, Deserialize)]
pub struct BudgetRecommendationQuery {
    pub max_price: rust_decimal::Decimal,
    pub limit: Option<usize>,
}

/// Query parameters for premium recommendations
#[derive(Debug, Deserialize)]
pub struct PremiumRecommendationQuery {
    pub min_price: rust_decimal::Decimal,
    pub limit: Option<usize>,
}

/// Response for recommendation endpoints
#[derive(Debug, Serialize)]
pub struct RecommendationResponse {
    pub pet_type: PetType,
    pub recommendations: Vec<Food>,
    pub total_count: usize,
}

/// State for recommendation handlers
#[derive(Clone)]
pub struct RecommendationHandlerState {
    pub recommendation_service: Arc<RecommendationService>,
}

/// Create recommendation router with all endpoints
pub fn create_recommendation_router(recommendation_service: Arc<RecommendationService>) -> Router {
    let state = RecommendationHandlerState { recommendation_service };

    Router::new()
        .route("/api/recommendations/:pet_type", get(get_recommendations))
        .route("/api/recommendations/:pet_type/filtered", get(get_filtered_recommendations))
        .route("/api/recommendations/:pet_type/top", get(get_top_recommendations))
        .route("/api/recommendations/:pet_type/budget", get(get_budget_recommendations))
        .route("/api/recommendations/:pet_type/premium", get(get_premium_recommendations))
        .route("/api/recommendations/:pet_type/stats", get(get_recommendation_stats))
        .route("/api/recommendations/:pet_type/:food_type", get(get_recommendations_by_food_type))
        .with_state(state)
}

/// Get basic recommendations for a pet type
#[instrument(skip(state))]
pub async fn get_recommendations(
    State(state): State<RecommendationHandlerState>,
    Path(pet_type_str): Path<String>,
) -> Result<Json<RecommendationResponse>, (StatusCode, Json<Value>)> {
    info!("Getting recommendations for pet type: {}", pet_type_str);

    let pet_type = match pet_type_str.parse::<PetType>() {
        Ok(pt) => pt,
        Err(err) => {
            error!("Invalid pet type: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid pet type",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    match state.recommendation_service.get_recommendations(pet_type.clone()).await {
        Ok(recommendations) => {
            info!("Successfully retrieved {} recommendations", recommendations.len());
            Ok(Json(RecommendationResponse {
                pet_type,
                total_count: recommendations.len(),
                recommendations,
            }))
        }
        Err(err) => {
            error!("Failed to get recommendations: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get filtered recommendations for a pet type
#[instrument(skip(state))]
pub async fn get_filtered_recommendations(
    State(state): State<RecommendationHandlerState>,
    Path(pet_type_str): Path<String>,
    Query(query): Query<RecommendationQuery>,
) -> Result<Json<RecommendationResponse>, (StatusCode, Json<Value>)> {
    info!("Getting filtered recommendations for pet type: {}", pet_type_str);

    let pet_type = match pet_type_str.parse::<PetType>() {
        Ok(pt) => pt,
        Err(err) => {
            error!("Invalid pet type: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid pet type",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    // Parse food type if provided
    let food_type = if let Some(food_type_str) = query.food_type {
        match food_type_str.parse::<FoodType>() {
            Ok(ft) => Some(ft),
            Err(err) => {
                error!("Invalid food type: {}", err);
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": "Invalid food type",
                        "message": err,
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                    })),
                ));
            }
        }
    } else {
        None
    };

    match state.recommendation_service.get_filtered_recommendations(
        pet_type.clone(),
        food_type,
        query.max_price,
        query.limit,
    ).await {
        Ok(recommendations) => {
            info!("Successfully retrieved {} filtered recommendations", recommendations.len());
            Ok(Json(RecommendationResponse {
                pet_type,
                total_count: recommendations.len(),
                recommendations,
            }))
        }
        Err(err) => {
            error!("Failed to get filtered recommendations: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get top recommendations for a pet type
#[instrument(skip(state))]
pub async fn get_top_recommendations(
    State(state): State<RecommendationHandlerState>,
    Path(pet_type_str): Path<String>,
    Query(query): Query<RecommendationQuery>,
) -> Result<Json<RecommendationResponse>, (StatusCode, Json<Value>)> {
    info!("Getting top recommendations for pet type: {}", pet_type_str);

    let pet_type = match pet_type_str.parse::<PetType>() {
        Ok(pt) => pt,
        Err(err) => {
            error!("Invalid pet type: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid pet type",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    let limit = query.limit.unwrap_or(10);

    match state.recommendation_service.get_top_recommendations(pet_type.clone(), limit).await {
        Ok(recommendations) => {
            info!("Successfully retrieved {} top recommendations", recommendations.len());
            Ok(Json(RecommendationResponse {
                pet_type,
                total_count: recommendations.len(),
                recommendations,
            }))
        }
        Err(err) => {
            error!("Failed to get top recommendations: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get budget-friendly recommendations for a pet type
#[instrument(skip(state))]
pub async fn get_budget_recommendations(
    State(state): State<RecommendationHandlerState>,
    Path(pet_type_str): Path<String>,
    Query(query): Query<BudgetRecommendationQuery>,
) -> Result<Json<RecommendationResponse>, (StatusCode, Json<Value>)> {
    info!("Getting budget recommendations for pet type: {}", pet_type_str);

    let pet_type = match pet_type_str.parse::<PetType>() {
        Ok(pt) => pt,
        Err(err) => {
            error!("Invalid pet type: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid pet type",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    match state.recommendation_service.get_budget_recommendations(
        pet_type.clone(),
        query.max_price,
        query.limit,
    ).await {
        Ok(recommendations) => {
            info!("Successfully retrieved {} budget recommendations", recommendations.len());
            Ok(Json(RecommendationResponse {
                pet_type,
                total_count: recommendations.len(),
                recommendations,
            }))
        }
        Err(err) => {
            error!("Failed to get budget recommendations: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get premium recommendations for a pet type
#[instrument(skip(state))]
pub async fn get_premium_recommendations(
    State(state): State<RecommendationHandlerState>,
    Path(pet_type_str): Path<String>,
    Query(query): Query<PremiumRecommendationQuery>,
) -> Result<Json<RecommendationResponse>, (StatusCode, Json<Value>)> {
    info!("Getting premium recommendations for pet type: {}", pet_type_str);

    let pet_type = match pet_type_str.parse::<PetType>() {
        Ok(pt) => pt,
        Err(err) => {
            error!("Invalid pet type: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid pet type",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    match state.recommendation_service.get_premium_recommendations(
        pet_type.clone(),
        query.min_price,
        query.limit,
    ).await {
        Ok(recommendations) => {
            info!("Successfully retrieved {} premium recommendations", recommendations.len());
            Ok(Json(RecommendationResponse {
                pet_type,
                total_count: recommendations.len(),
                recommendations,
            }))
        }
        Err(err) => {
            error!("Failed to get premium recommendations: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get recommendations by food type for a pet type
#[instrument(skip(state))]
pub async fn get_recommendations_by_food_type(
    State(state): State<RecommendationHandlerState>,
    Path((pet_type_str, food_type_str)): Path<(String, String)>,
) -> Result<Json<RecommendationResponse>, (StatusCode, Json<Value>)> {
    info!("Getting recommendations for pet type: {} and food type: {}", pet_type_str, food_type_str);

    let pet_type = match pet_type_str.parse::<PetType>() {
        Ok(pt) => pt,
        Err(err) => {
            error!("Invalid pet type: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid pet type",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    let food_type = match food_type_str.parse::<FoodType>() {
        Ok(ft) => ft,
        Err(err) => {
            error!("Invalid food type: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid food type",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    match state.recommendation_service.get_recommendations_by_food_type(pet_type.clone(), food_type).await {
        Ok(recommendations) => {
            info!("Successfully retrieved {} recommendations by food type", recommendations.len());
            Ok(Json(RecommendationResponse {
                pet_type,
                total_count: recommendations.len(),
                recommendations,
            }))
        }
        Err(err) => {
            error!("Failed to get recommendations by food type: {}", err);
            Err(service_error_to_response(err))
        }
    }
}

/// Get recommendation statistics for a pet type
#[instrument(skip(state))]
pub async fn get_recommendation_stats(
    State(state): State<RecommendationHandlerState>,
    Path(pet_type_str): Path<String>,
) -> Result<Json<RecommendationStats>, (StatusCode, Json<Value>)> {
    info!("Getting recommendation stats for pet type: {}", pet_type_str);

    let pet_type = match pet_type_str.parse::<PetType>() {
        Ok(pt) => pt,
        Err(err) => {
            error!("Invalid pet type: {}", err);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Invalid pet type",
                    "message": err,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                })),
            ));
        }
    };

    match state.recommendation_service.get_recommendation_stats(pet_type).await {
        Ok(stats) => {
            info!("Successfully retrieved recommendation stats");
            Ok(Json(stats))
        }
        Err(err) => {
            error!("Failed to get recommendation stats: {}", err);
            Err(service_error_to_response(err))
        }
    }
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

    #[test]
    fn test_recommendation_response_serialization() {
        let response = RecommendationResponse {
            pet_type: PetType::Puppy,
            recommendations: vec![],
            total_count: 0,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("puppy"));
        assert!(json.contains("total_count"));
    }

    #[test]
    fn test_recommendation_query_deserialization() {
        let json = r#"{"food_type": "dry", "max_price": 15.99, "limit": 5}"#;
        let query: RecommendationQuery = serde_json::from_str(json).unwrap();

        assert_eq!(query.food_type, Some("dry".to_string()));
        assert_eq!(query.max_price, Some(rust_decimal_macros::dec!(15.99)));
        assert_eq!(query.limit, Some(5));
    }

    #[test]
    fn test_budget_recommendation_query_deserialization() {
        let json = r#"{"max_price": 10.00, "limit": 3}"#;
        let query: BudgetRecommendationQuery = serde_json::from_str(json).unwrap();

        assert_eq!(query.max_price, rust_decimal_macros::dec!(10.00));
        assert_eq!(query.limit, Some(3));
    }

    #[test]
    fn test_premium_recommendation_query_deserialization() {
        let json = r#"{"min_price": 20.00, "limit": 5}"#;
        let query: PremiumRecommendationQuery = serde_json::from_str(json).unwrap();

        assert_eq!(query.min_price, rust_decimal_macros::dec!(20.00));
        assert_eq!(query.limit, Some(5));
    }
}