use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{error, info, instrument, warn};

use crate::models::{
    CreateFoodRequest, PetType, FoodType,
};
use crate::services::FoodService;
use crate::repositories::TableManager;

/// Admin state containing services
#[derive(Clone)]
pub struct AdminState {
    pub food_service: Arc<FoodService>,
    pub table_manager: Arc<TableManager>,
    pub foods_table_name: String,
    pub carts_table_name: String,
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
) -> Router {
    let state = AdminState { 
        food_service,
        table_manager,
        foods_table_name,
        carts_table_name,
    };

    Router::new()
        // Database setup and management endpoints
        .route("/api/admin/setup-tables", post(setup_tables))
        .route("/api/admin/seed", post(seed_database))
        .route("/api/admin/cleanup", post(cleanup_database))
        
        .with_state(state)
}



// =============================================================================
// DATABASE SETUP, SEEDING AND CLEANUP ENDPOINTS
// =============================================================================

/// Set up the required DynamoDB tables
#[instrument(skip(state))]
pub async fn setup_tables(
    State(state): State<AdminState>,
) -> Result<Json<SetupTablesResponse>, (StatusCode, Json<Value>)> {
    let timestamp = chrono::Utc::now().to_rfc3339();
    
    info!("Setting up DynamoDB tables");

    match state.table_manager.create_all_tables(&state.foods_table_name, &state.carts_table_name).await {
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
#[instrument(skip(state))]
pub async fn seed_database(
    State(state): State<AdminState>,
) -> Result<Json<SeedResponse>, (StatusCode, Json<Value>)> {
    let timestamp = chrono::Utc::now().to_rfc3339();
    
    info!("Seeding database with sample data");

    let sample_foods = create_sample_foods();
    let mut created_count = 0;
    let mut errors = Vec::new();

    for food_request in sample_foods {
        match state.food_service.create_food(food_request.clone()).await {
            Ok(_) => {
                created_count += 1;
                info!("Successfully seeded food: {}", food_request.food_name);
            }
            Err(err) => {
                warn!("Failed to seed food {}: {}", food_request.food_name, err);
                errors.push(format!("{}: {}", food_request.food_name, err));
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
                message: format!("Database seeded with {} foods, {} errors occurred", created_count, errors.len()),
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
#[instrument(skip(state))]
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
                match state.food_service.delete_food(&food.food_id).await {
                    Ok(()) => {
                        deleted_count += 1;
                        info!("Successfully deleted food: {}", food.food_name);
                    }
                    Err(err) => {
                        warn!("Failed to delete food {}: {}", food.food_name, err);
                        errors.push(format!("{}: {}", food.food_name, err));
                    }
                }
            }

            if errors.is_empty() {
                info!("Successfully cleaned up database, deleted {} foods", deleted_count);
                
                Ok(Json(CleanupResponse {
                    message: format!("Database cleaned up successfully, deleted {} foods", deleted_count),
                    foods_deleted: deleted_count,
                    timestamp,
                }))
            } else {
                warn!("Database cleanup completed with {} errors", errors.len());
                
                Ok(Json(CleanupResponse {
                    message: format!("Database cleanup completed with {} foods deleted, {} errors occurred", deleted_count, errors.len()),
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
// HELPER FUNCTIONS
// =============================================================================

/// Create sample food data for all pet types
fn create_sample_foods() -> Vec<CreateFoodRequest> {
    vec![
        // Puppy foods
        CreateFoodRequest {
            food_for: PetType::Puppy,
            food_name: "Beef and Turkey Kibbles".to_string(),
            food_type: FoodType::Dry,
            food_description: "A nutritious blend of beef and turkey, specially formulated for growing puppies.".to_string(),
            food_price: rust_decimal_macros::dec!(12.99),
            food_image: "beef-turkey-kibbles.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["beef".to_string(), "turkey".to_string(), "rice".to_string(), "vegetables".to_string()],
            feeding_guidelines: Some("Feed 2-3 times daily based on puppy's weight".to_string()),
            stock_quantity: 50,
        },
        CreateFoodRequest {
            food_for: PetType::Puppy,
            food_name: "Raw Chicken Bites".to_string(),
            food_type: FoodType::Wet,
            food_description: "Tender raw chicken bites, ideal for puppies who love a meaty treat.".to_string(),
            food_price: rust_decimal_macros::dec!(10.99),
            food_image: "raw-chicken-bites.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["chicken".to_string(), "chicken broth".to_string(), "vitamins".to_string()],
            feeding_guidelines: Some("Serve as a supplement to dry food".to_string()),
            stock_quantity: 30,
        },
        CreateFoodRequest {
            food_for: PetType::Puppy,
            food_name: "Puppy Training Treats".to_string(),
            food_type: FoodType::Treats,
            food_description: "Small, soft treats perfect for training sessions with puppies.".to_string(),
            food_price: rust_decimal_macros::dec!(8.99),
            food_image: "puppy-training-treats.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["chicken meal".to_string(), "sweet potato".to_string(), "peas".to_string()],
            feeding_guidelines: Some("Use sparingly during training sessions".to_string()),
            stock_quantity: 75,
        },
        
        // Kitten foods
        CreateFoodRequest {
            food_for: PetType::Kitten,
            food_name: "Salmon and Tuna Delight".to_string(),
            food_type: FoodType::Wet,
            food_description: "A delectable mix of salmon and tuna, perfect for kittens.".to_string(),
            food_price: rust_decimal_macros::dec!(14.99),
            food_image: "salmon-tuna-delight.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["salmon".to_string(), "tuna".to_string(), "fish broth".to_string(), "vitamins".to_string()],
            feeding_guidelines: Some("Feed 3-4 times daily for growing kittens".to_string()),
            stock_quantity: 40,
        },
        CreateFoodRequest {
            food_for: PetType::Kitten,
            food_name: "Kitten Growth Formula".to_string(),
            food_type: FoodType::Dry,
            food_description: "High-protein dry food specially formulated for kitten growth and development.".to_string(),
            food_price: rust_decimal_macros::dec!(16.99),
            food_image: "kitten-growth-formula.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["chicken meal".to_string(), "fish meal".to_string(), "rice".to_string(), "taurine".to_string()],
            feeding_guidelines: Some("Free feeding recommended for kittens under 6 months".to_string()),
            stock_quantity: 60,
        },
        CreateFoodRequest {
            food_for: PetType::Kitten,
            food_name: "Catnip Kitten Treats".to_string(),
            food_type: FoodType::Treats,
            food_description: "Irresistible catnip-infused treats that kittens love.".to_string(),
            food_price: rust_decimal_macros::dec!(6.99),
            food_image: "catnip-kitten-treats.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["chicken".to_string(), "catnip".to_string(), "wheat flour".to_string()],
            feeding_guidelines: Some("Give 2-3 treats per day as rewards".to_string()),
            stock_quantity: 80,
        },
        
        // Bunny foods
        CreateFoodRequest {
            food_for: PetType::Bunny,
            food_name: "Carrot and Herb Crunchies".to_string(),
            food_type: FoodType::Dry,
            food_description: "Crunchy carrot and herb treats, specially designed for bunnies.".to_string(),
            food_price: rust_decimal_macros::dec!(8.99),
            food_image: "carrot-herb-crunchies.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["carrots".to_string(), "timothy hay".to_string(), "herbs".to_string(), "oats".to_string()],
            feeding_guidelines: Some("Supplement to hay-based diet, 1/4 cup daily".to_string()),
            stock_quantity: 45,
        },
        CreateFoodRequest {
            food_for: PetType::Bunny,
            food_name: "Timothy Hay Pellets".to_string(),
            food_type: FoodType::Dry,
            food_description: "High-fiber timothy hay pellets essential for bunny digestive health.".to_string(),
            food_price: rust_decimal_macros::dec!(12.99),
            food_image: "timothy-hay-pellets.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["timothy hay".to_string(), "alfalfa".to_string(), "vitamins".to_string(), "minerals".to_string()],
            feeding_guidelines: Some("1/4 to 1/2 cup daily depending on bunny size".to_string()),
            stock_quantity: 35,
        },
        CreateFoodRequest {
            food_for: PetType::Bunny,
            food_name: "Fresh Veggie Mix".to_string(),
            food_type: FoodType::Wet,
            food_description: "A fresh mix of vegetables perfect for bunny nutrition.".to_string(),
            food_price: rust_decimal_macros::dec!(9.99),
            food_image: "fresh-veggie-mix.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["carrots".to_string(), "leafy greens".to_string(), "bell peppers".to_string(), "herbs".to_string()],
            feeding_guidelines: Some("Serve fresh daily as part of balanced diet".to_string()),
            stock_quantity: 25,
        },
    ]
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_sample_foods() {
        let sample_foods = create_sample_foods();
        
        // Should have foods for all pet types
        assert!(sample_foods.iter().any(|f| f.food_for == PetType::Puppy));
        assert!(sample_foods.iter().any(|f| f.food_for == PetType::Kitten));
        assert!(sample_foods.iter().any(|f| f.food_for == PetType::Bunny));
        
        // Should have different food types
        assert!(sample_foods.iter().any(|f| f.food_type == FoodType::Dry));
        assert!(sample_foods.iter().any(|f| f.food_type == FoodType::Wet));
        assert!(sample_foods.iter().any(|f| f.food_type == FoodType::Treats));
        
        // All foods should have valid data
        for food in &sample_foods {
            assert!(!food.food_name.is_empty());
            assert!(!food.food_description.is_empty());
            assert!(food.food_price > rust_decimal::Decimal::ZERO);
            assert!(!food.ingredients.is_empty());
            assert!(food.stock_quantity > 0);
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