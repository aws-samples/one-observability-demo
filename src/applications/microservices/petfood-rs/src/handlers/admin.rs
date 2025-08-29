use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{post, put},
    Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{error, info, instrument, warn};

use crate::models::{CreateFoodRequest, CreationSource, FoodType, PetType, UpdateFoodRequest};
use crate::repositories::TableManager;
use crate::services::FoodService;

/// Admin state containing services
#[derive(Clone)]
pub struct AdminState {
    pub food_service: Arc<FoodService>,
    pub table_manager: Arc<TableManager>,
    pub foods_table_name: String,
    pub carts_table_name: String,
    pub assets_cdn_url: String,
}

/// Response for seeding operations
#[derive(Debug, Serialize)]
pub struct SeedResponse {
    pub message: String,
    pub foods_created: usize,
    pub timestamp: String,
}

/// Response for cleanup operations
#[derive(Debug, Serialize)]
pub struct CleanupResponse {
    pub message: String,
    pub foods_deleted: usize,
    pub timestamp: String,
}

/// Response for table setup operations
#[derive(Debug, Serialize)]
pub struct SetupTablesResponse {
    pub message: String,
    pub tables_created: Vec<String>,
    pub timestamp: String,
}

/// Create admin router with database management endpoints
pub fn create_admin_router(
    food_service: Arc<FoodService>,
    table_manager: Arc<TableManager>,
    foods_table_name: String,
    carts_table_name: String,
    assets_cdn_url: String,
) -> Router {
    let state = AdminState {
        food_service,
        table_manager,
        foods_table_name,
        carts_table_name,
        assets_cdn_url,
    };

    Router::new()
        // Database setup and management endpoints
        .route("/api/admin/setup-tables", post(setup_tables))
        .route("/api/admin/seed", post(seed_database))
        .route("/api/admin/cleanup", post(cleanup_database))
        // Food management endpoints (admin only)
        .route("/api/admin/foods", post(create_food))
        .route(
            "/api/admin/foods/:food_id",
            put(update_food).delete(delete_food),
        )
        .with_state(state)
}

// =============================================================================
// DATABASE SETUP, SEEDING AND CLEANUP ENDPOINTS
// =============================================================================

/// Set up the required DynamoDB tables
#[instrument(name = "setup_tables", skip(state), fields(
    foods_table = %state.foods_table_name,
    carts_table = %state.carts_table_name,
))]
pub async fn setup_tables(
    State(state): State<AdminState>,
) -> Result<Json<SetupTablesResponse>, (StatusCode, Json<Value>)> {
    let timestamp = chrono::Utc::now().to_rfc3339();

    info!("Setting up DynamoDB tables");

    match state
        .table_manager
        .create_all_tables(&state.foods_table_name, &state.carts_table_name)
        .await
    {
        Ok(()) => {
            let tables_created = vec![
                state.foods_table_name.clone(),
                state.carts_table_name.clone(),
            ];

            info!("Successfully created tables: {:?}", tables_created);

            Ok(Json(SetupTablesResponse {
                message: format!("Successfully created {} tables", tables_created.len()),
                tables_created,
                timestamp,
            }))
        }
        Err(err) => {
            error!("Failed to create tables: {}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to create tables",
                    "message": err.to_string(),
                    "timestamp": timestamp,
                })),
            ))
        }
    }
}

/// Seed the database with sample food data for all pet types
#[instrument(name = "seed_database", skip(state), fields(
    foods_table = %state.foods_table_name,
))]
pub async fn seed_database(
    State(state): State<AdminState>,
) -> Result<Json<SeedResponse>, (StatusCode, Json<Value>)> {
    let timestamp = chrono::Utc::now().to_rfc3339();

    info!("Seeding database with sample data");

    let sample_foods = create_sample_foods(&state.assets_cdn_url);
    let mut created_count = 0;
    let mut errors = Vec::new();

    for food_request in sample_foods {
        match state
            .food_service
            .create_food(food_request.clone(), CreationSource::Seeding)
            .await
        {
            Ok(_) => {
                created_count += 1;
                info!("Successfully seeded food: {}", food_request.name);
            }
            Err(err) => {
                warn!("Failed to seed food {}: {}", food_request.name, err);
                errors.push(format!("{}: {}", food_request.name, err));
            }
        }
    }

    if errors.is_empty() {
        info!("Successfully seeded database with {} foods", created_count);

        Ok(Json(SeedResponse {
            message: format!("Database seeded successfully with {} foods", created_count),
            foods_created: created_count,
            timestamp,
        }))
    } else {
        warn!("Database seeding completed with {} errors", errors.len());

        if created_count > 0 {
            Ok(Json(SeedResponse {
                message: format!(
                    "Database seeded with {} foods, {} errors occurred",
                    created_count,
                    errors.len()
                ),
                foods_created: created_count,
                timestamp,
            }))
        } else {
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to seed database",
                    "details": errors,
                    "timestamp": timestamp,
                })),
            ))
        }
    }
}

/// Clean up the database (for workshop reset functionality)
#[instrument(name = "cleanup_database", skip(state), fields(
    foods_table = %state.foods_table_name,
))]
pub async fn cleanup_database(
    State(state): State<AdminState>,
) -> Result<Json<CleanupResponse>, (StatusCode, Json<Value>)> {
    let timestamp = chrono::Utc::now().to_rfc3339();

    info!("Cleaning up database");

    // Get all foods first
    match state.food_service.list_foods(Default::default()).await {
        Ok(food_list) => {
            let mut deleted_count = 0;
            let mut errors = Vec::new();

            for food in food_list.foods {
                match state.food_service.delete_food(&food.id).await {
                    Ok(()) => {
                        deleted_count += 1;
                        info!("Successfully discontinued food: {}", food.name);
                    }
                    Err(err) => {
                        warn!("Failed to discontinue food {}: {}", food.name, err);
                        errors.push(format!("{}: {}", food.name, err));
                    }
                }
            }

            if errors.is_empty() {
                info!(
                    "Successfully cleaned up database, discontinued {} foods",
                    deleted_count
                );

                Ok(Json(CleanupResponse {
                    message: format!(
                        "Database cleaned up successfully, discontinued {} foods",
                        deleted_count
                    ),
                    foods_deleted: deleted_count,
                    timestamp,
                }))
            } else {
                warn!("Database cleanup completed with {} errors", errors.len());

                Ok(Json(CleanupResponse {
                    message: format!(
                        "Database cleanup completed with {} foods discontinued, {} errors occurred",
                        deleted_count,
                        errors.len()
                    ),
                    foods_deleted: deleted_count,
                    timestamp,
                }))
            }
        }
        Err(err) => {
            error!("Failed to list foods for cleanup: {}", err);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to cleanup database",
                    "message": err.to_string(),
                    "timestamp": timestamp,
                })),
            ))
        }
    }
}

// =============================================================================
// FOOD MANAGEMENT ENDPOINTS (ADMIN ONLY)
// =============================================================================

/// Create a new food product (admin only)
#[instrument(name = "create_food", skip(state, request), fields(
    food_name = %request.name,
    pet_type = ?request.pet_type,
    food_type = ?request.food_type,
    price = %request.price,
))]
pub async fn create_food(
    State(state): State<AdminState>,
    Json(request): Json<CreateFoodRequest>,
) -> Result<(StatusCode, Json<crate::models::FoodResponse>), (StatusCode, Json<Value>)> {
    let timestamp = chrono::Utc::now().to_rfc3339();

    info!("Admin creating new food: {}", request.name);

    match state
        .food_service
        .create_food(request, CreationSource::AdminApi)
        .await
    {
        Ok(food) => {
            info!("Successfully created food with ID: {}", food.id);
            let food_response = food.to_response(&state.assets_cdn_url);
            Ok((StatusCode::CREATED, Json(food_response)))
        }
        Err(err) => {
            error!("Failed to create food: {}", err);
            Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Failed to create food",
                    "message": err.to_string(),
                    "timestamp": timestamp,
                })),
            ))
        }
    }
}

/// Update an existing food product (admin only)
#[instrument(name = "update_food", skip(state, request), fields(
    food_id = %food_id,
    food_name = request.name.as_deref(),
    price = request.price.as_ref().map(|p| p.to_string()).as_deref(),
    stock_quantity = ?request.stock_quantity,
))]
pub async fn update_food(
    State(state): State<AdminState>,
    Path(food_id): Path<String>,
    Json(request): Json<UpdateFoodRequest>,
) -> Result<Json<crate::models::FoodResponse>, (StatusCode, Json<Value>)> {
    let timestamp = chrono::Utc::now().to_rfc3339();

    info!("Admin updating food with ID: {}", food_id);

    match state.food_service.update_food(&food_id, request).await {
        Ok(food) => {
            info!("Successfully updated food: {}", food.name);
            let food_response = food.to_response(&state.assets_cdn_url);
            Ok(Json(food_response))
        }
        Err(err) => {
            error!("Failed to update food {}: {}", food_id, err);
            let status = match err {
                crate::models::ServiceError::FoodNotFound { .. } => StatusCode::NOT_FOUND,
                crate::models::ServiceError::ValidationError { .. } => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };

            Err((
                status,
                Json(json!({
                    "error": "Failed to update food",
                    "message": err.to_string(),
                    "timestamp": timestamp,
                })),
            ))
        }
    }
}

/// Delete a food product (admin only)
#[instrument(name = "delete_food", skip(state), fields(
    food_id = %food_id,
))]
pub async fn delete_food(
    State(state): State<AdminState>,
    Path(food_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let timestamp = chrono::Utc::now().to_rfc3339();

    info!("Admin deleting food with ID: {}", food_id);

    match state.food_service.delete_food(&food_id).await {
        Ok(()) => {
            info!("Successfully deleted food: {}", food_id);
            Ok(StatusCode::NO_CONTENT)
        }
        Err(err) => {
            error!("Failed to delete food {}: {}", food_id, err);
            let status = match err {
                crate::models::ServiceError::FoodNotFound { .. } => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };

            Err((
                status,
                Json(json!({
                    "error": "Failed to delete food",
                    "message": err.to_string(),
                    "timestamp": timestamp,
                })),
            ))
        }
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Helper function to create image path with petfood prefix
fn create_image_path(image_name: &str) -> String {
    format!("petfood/{}", image_name)
}

/// Create sample food data for all pet types
fn create_sample_foods(_assets_cdn_url: &str) -> Vec<CreateFoodRequest> {
    vec![
        // Puppy foods
        CreateFoodRequest {
            pet_type: PetType::Puppy,
            name: "Beef and Turkey Kibbles".to_string(),
            food_type: FoodType::Dry,
            description:
                "A nutritious blend of beef and turkey, specially formulated for growing puppies."
                    .to_string(),
            price: rust_decimal_macros::dec!(12.99),
            image: create_image_path("beef-turkey-kibbles.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "beef".to_string(),
                "turkey".to_string(),
                "rice".to_string(),
                "vegetables".to_string(),
            ],
            feeding_guidelines: Some("Feed 2-3 times daily based on puppy's weight".to_string()),
            stock_quantity: 50,
        },
        CreateFoodRequest {
            pet_type: PetType::Puppy,
            name: "Raw Chicken Bites".to_string(),
            food_type: FoodType::Wet,
            description: "Tender raw chicken bites, ideal for puppies who love a meaty treat."
                .to_string(),
            price: rust_decimal_macros::dec!(10.99),
            image: create_image_path("raw-chicken-bites.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "chicken".to_string(),
                "chicken broth".to_string(),
                "vitamins".to_string(),
            ],
            feeding_guidelines: Some("Serve as a supplement to dry food".to_string()),
            stock_quantity: 30,
        },
        CreateFoodRequest {
            pet_type: PetType::Puppy,
            name: "Puppy Training Treats".to_string(),
            food_type: FoodType::Treats,
            description: "Small, soft treats perfect for training sessions with puppies."
                .to_string(),
            price: rust_decimal_macros::dec!(8.99),
            image: create_image_path("puppy-training-treats.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "chicken meal".to_string(),
                "sweet potato".to_string(),
                "peas".to_string(),
            ],
            feeding_guidelines: Some("Use sparingly during training sessions".to_string()),
            stock_quantity: 75,
        },
        // Kitten foods
        CreateFoodRequest {
            pet_type: PetType::Kitten,
            name: "Salmon and Tuna Delight".to_string(),
            food_type: FoodType::Wet,
            description: "A delectable mix of salmon and tuna, perfect for kittens.".to_string(),
            price: rust_decimal_macros::dec!(14.99),
            image: create_image_path("salmon-tuna-delight.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "salmon".to_string(),
                "tuna".to_string(),
                "fish broth".to_string(),
                "vitamins".to_string(),
            ],
            feeding_guidelines: Some("Feed 3-4 times daily for growing kittens".to_string()),
            stock_quantity: 40,
        },
        CreateFoodRequest {
            pet_type: PetType::Kitten,
            name: "Kitten Growth Formula".to_string(),
            food_type: FoodType::Dry,
            description:
                "High-protein dry food specially formulated for kitten growth and development."
                    .to_string(),
            price: rust_decimal_macros::dec!(16.99),
            image: create_image_path("kitten-growth-formula.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "chicken meal".to_string(),
                "fish meal".to_string(),
                "rice".to_string(),
                "taurine".to_string(),
            ],
            feeding_guidelines: Some(
                "Free feeding recommended for kittens under 6 months".to_string(),
            ),
            stock_quantity: 60,
        },
        CreateFoodRequest {
            pet_type: PetType::Kitten,
            name: "Catnip Kitten Treats".to_string(),
            food_type: FoodType::Treats,
            description: "Irresistible catnip-infused treats that kittens love.".to_string(),
            price: rust_decimal_macros::dec!(6.99),
            image: create_image_path("catnip-kitten-treats.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "chicken".to_string(),
                "catnip".to_string(),
                "wheat flour".to_string(),
            ],
            feeding_guidelines: Some("Give 2-3 treats per day as rewards".to_string()),
            stock_quantity: 80,
        },
        // Bunny foods
        CreateFoodRequest {
            pet_type: PetType::Bunny,
            name: "Carrot and Herb Crunchies".to_string(),
            food_type: FoodType::Dry,
            description: "Crunchy carrot and herb treats, specially designed for bunnies."
                .to_string(),
            price: rust_decimal_macros::dec!(8.99),
            image: create_image_path("carrot-herb-crunchies.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "carrots".to_string(),
                "timothy hay".to_string(),
                "herbs".to_string(),
                "oats".to_string(),
            ],
            feeding_guidelines: Some("Supplement to hay-based diet, 1/4 cup daily".to_string()),
            stock_quantity: 45,
        },
        CreateFoodRequest {
            pet_type: PetType::Bunny,
            name: "Timothy Hay Pellets".to_string(),
            food_type: FoodType::Dry,
            description: "High-fiber timothy hay pellets essential for bunny digestive health."
                .to_string(),
            price: rust_decimal_macros::dec!(12.99),
            image: create_image_path("timothy-hay-pellets.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "timothy hay".to_string(),
                "alfalfa".to_string(),
                "vitamins".to_string(),
                "minerals".to_string(),
            ],
            feeding_guidelines: Some("1/4 to 1/2 cup daily depending on bunny size".to_string()),
            stock_quantity: 35,
        },
        CreateFoodRequest {
            pet_type: PetType::Bunny,
            name: "Fresh Veggie Mix".to_string(),
            food_type: FoodType::Wet,
            description: "A fresh mix of vegetables perfect for bunny nutrition.".to_string(),
            price: rust_decimal_macros::dec!(9.99),
            image: create_image_path("fresh-veggie-mix.jpg"),
            nutritional_info: None,
            ingredients: vec![
                "carrots".to_string(),
                "leafy greens".to_string(),
                "bell peppers".to_string(),
                "herbs".to_string(),
            ],
            feeding_guidelines: Some("Serve fresh daily as part of balanced diet".to_string()),
            stock_quantity: 25,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_image_path() {
        let path = create_image_path("test-image.jpg");
        assert_eq!(path, "petfood/test-image.jpg");
    }

    #[test]
    fn test_create_sample_foods() {
        let sample_foods = create_sample_foods("https://test-cdn.example.com");

        // Should have foods for all pet types
        assert!(sample_foods.iter().any(|f| f.pet_type == PetType::Puppy));
        assert!(sample_foods.iter().any(|f| f.pet_type == PetType::Kitten));
        assert!(sample_foods.iter().any(|f| f.pet_type == PetType::Bunny));

        // Should have different food types
        assert!(sample_foods.iter().any(|f| f.food_type == FoodType::Dry));
        assert!(sample_foods.iter().any(|f| f.food_type == FoodType::Wet));
        assert!(sample_foods.iter().any(|f| f.food_type == FoodType::Treats));

        // All foods should have valid data
        for food in &sample_foods {
            assert!(!food.name.is_empty());
            assert!(!food.description.is_empty());
            assert!(food.price > rust_decimal::Decimal::ZERO);
            assert!(!food.ingredients.is_empty());
            assert!(food.stock_quantity > 0);
            // All images should be paths with petfood prefix
            assert!(food.image.starts_with("petfood/"));
            assert!(food.image.ends_with(".jpg"));
            assert!(!food.image.contains("http"));
        }
    }

    #[test]
    fn test_seed_response_serialization() {
        let response = SeedResponse {
            message: "Database seeded successfully".to_string(),
            foods_created: 9,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("Database seeded successfully"));
        assert!(json.contains("9"));
    }

    #[test]
    fn test_cleanup_response_serialization() {
        let response = CleanupResponse {
            message: "Database cleaned up successfully".to_string(),
            foods_deleted: 5,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("Database cleaned up successfully"));
        assert!(json.contains("5"));
    }

    #[test]
    fn test_setup_tables_response_serialization() {
        let response = SetupTablesResponse {
            message: "Successfully created 2 tables".to_string(),
            tables_created: vec!["foods".to_string(), "carts".to_string()],
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("Successfully created 2 tables"));
        assert!(json.contains("foods"));
        assert!(json.contains("carts"));
    }
}
