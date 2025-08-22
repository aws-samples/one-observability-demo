use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::{
    response::Json,
    routing::{get, post},
    Extension, Router,
};
use reqwest::Client;
use serde_json::json;
use tokio::net::TcpListener;

type CartState = Arc<Mutex<HashMap<String, serde_json::Value>>>;
type FoodState = Arc<Mutex<std::collections::HashSet<String>>>;

pub struct TestEnvironment {
    pub client: Client,
    pub base_url: String,
}

// Mock handlers for testing
async fn mock_health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "petfood-test",
        "version": "0.1.0"
    }))
}

use axum::extract::Query;

async fn mock_list_foods(
    Query(params): Query<HashMap<String, String>>,
    Extension(deleted_foods): Extension<FoodState>,
) -> Json<serde_json::Value> {
    let all_foods = vec![
        json!({
            "id": "F001",
            "name": "Premium Puppy Food",
            "pet_type": "puppy",
            "food_type": "dry",
            "price": 29.99,
            "description": "High-quality nutrition for growing puppies",
            "image": "https://example.com/puppy-food.jpg",
            "ingredients": ["chicken", "rice", "vegetables"],
            "nutritional_info": {
                "calories_per_serving": 350,
                "protein_percentage": 25.0,
                "fat_percentage": 15.0,
                "carbohydrate_percentage": 45.0,
                "fiber_percentage": 4.0,
                "moisture_percentage": 10.0,
                "serving_size": "1 cup",
                "servings_per_container": 50
            },
            "feeding_guidelines": "Feed 2-3 cups daily",
            "stock_quantity": 50,
            "is_active": true, "availability_status": "instock",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z"
        }),
        json!({
            "id": "F002",
            "name": "Kitten Wet Food",
            "pet_type": "kitten",
            "food_type": "wet",
            "price": 1.99,
            "description": "Delicious wet food for kittens",
            "image": "https://example.com/kitten-food.jpg",
            "ingredients": ["chicken", "rice", "vegetables"],
            "nutritional_info": {
                "calories_per_serving": 300,
                "protein_percentage": 30.0,
                "fat_percentage": 12.0,
                "carbohydrate_percentage": 40.0,
                "fiber_percentage": 3.0,
                "moisture_percentage": 78.0,
                "serving_size": "1 can",
                "servings_per_container": 1
            },
            "feeding_guidelines": "Feed 1-2 cans daily",
            "stock_quantity": 100,
            "is_active": true, "availability_status": "instock",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z"
        }),
        json!({
            "id": "F003",
            "name": "Puppy Training Treats",
            "pet_type": "puppy",
            "food_type": "treats",
            "price": 12.99,
            "description": "Perfect for training sessions",
            "image": "https://example.com/puppy-treats.jpg",
            "ingredients": ["chicken", "rice", "vegetables"],
            "nutritional_info": {
                "calories_per_serving": 50,
                "protein_percentage": 20.0,
                "fat_percentage": 8.0,
                "carbohydrate_percentage": 60.0,
                "fiber_percentage": 2.0,
                "moisture_percentage": 10.0,
                "serving_size": "5 treats",
                "servings_per_container": 20
            },
            "feeding_guidelines": "Give as treats, max 10 per day",
            "stock_quantity": 25,
            "is_active": true, "availability_status": "instock",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z"
        }),
    ];

    // Filter foods based on query parameters and deleted state
    let deleted = deleted_foods.lock().unwrap();
    let filtered_foods: Vec<_> = all_foods
        .into_iter()
        .filter(|food| {
            let mut matches = true;

            // Check if food is deleted
            if let Some(food_id) = food["id"].as_str() {
                if deleted.contains(food_id) {
                    return false;
                }
            }

            if let Some(food_type) = params.get("food_type") {
                matches = matches && food["food_type"].as_str() == Some(food_type);
            }

            if let Some(pet_type) = params.get("pet_type") {
                matches = matches && food["pet_type"].as_str() == Some(pet_type);
            }

            matches
        })
        .collect();

    Json(json!({
        "foods": filtered_foods,
        "total_count": filtered_foods.len()
    }))
}

async fn mock_admin_seed() -> Json<serde_json::Value> {
    Json(json!({
        "message": "Database seeded successfully",
        "foods_created": 3
    }))
}

async fn mock_admin_cleanup(
    Extension(deleted_foods): Extension<FoodState>,
) -> Json<serde_json::Value> {
    // Mark all foods as deleted
    let mut deleted = deleted_foods.lock().unwrap();
    deleted.insert("F001".to_string());
    deleted.insert("F002".to_string());
    deleted.insert("F003".to_string());

    Json(json!({
        "message": "Database cleaned up successfully",
        "foods_deleted": 3
    }))
}

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

async fn mock_get_food(
    Path(food_id): Path<String>,
    Extension(deleted_foods): Extension<FoodState>,
) -> Response {
    // Check if food is deleted
    let deleted = deleted_foods.lock().unwrap();
    if deleted.contains(&food_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "Food not found"
            })),
        )
            .into_response();
    }
    drop(deleted);
    match food_id.as_str() {
        "F001" => Json(json!({
            "id": "F001",
            "name": "Premium Puppy Food",
            "pet_type": "puppy",
            "food_type": "dry",
            "price": 29.99,
            "description": "High-quality nutrition for growing puppies",
            "image": "https://example.com/puppy-food.jpg",
            "ingredients": ["chicken", "rice", "vegetables"],
            "nutritional_info": {
                "calories_per_serving": 350,
                "protein_percentage": 25.0,
                "fat_percentage": 15.0,
                "carbohydrate_percentage": 45.0,
                "fiber_percentage": 4.0,
                "moisture_percentage": 10.0,
                "serving_size": "1 cup",
                "servings_per_container": 50
            },
            "feeding_guidelines": "Feed 2-3 cups daily",
            "stock_quantity": 50,
            "is_active": true,
            "availability_status": "instock",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z"
        }))
        .into_response(),
        "F12345678" => Json(json!({
            "id": "F12345678",
            "name": "Test Puppy Food",
            "pet_type": "puppy",
            "food_type": "dry",
            "price": 15.99,
            "description": "A test food for puppies",
            "image": "https://example.com/petfood/test-puppy-food.jpg",
            "ingredients": ["chicken", "rice"],
            "nutritional_info": null,
            "feeding_guidelines": "Feed twice daily",
            "stock_quantity": 100,
            "is_active": true,
            "availability_status": "instock",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z"
        }))
        .into_response(),
        _ => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "Food not found"
            })),
        )
            .into_response(),
    }
}

async fn mock_get_cart(
    Path(user_id): Path<String>,
    Extension(cart_state): Extension<CartState>,
) -> Json<serde_json::Value> {
    let carts = cart_state.lock().unwrap();
    let cart = carts.get(&user_id).cloned().unwrap_or_else(|| {
        json!({
            "user_id": user_id,
            "items": [],
            "total_items": 0,
            "total_price": 0.0,
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z"
        })
    });
    Json(cart)
}

use axum::extract::Json as ExtractJson;

async fn mock_add_cart_item(
    Path(user_id): Path<String>,
    Extension(cart_state): Extension<CartState>,
    ExtractJson(payload): ExtractJson<serde_json::Value>,
) -> Response {
    let food_id = payload
        .get("food_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match food_id {
        "F001" | "F002" | "F003" => {
            let quantity = payload
                .get("quantity")
                .and_then(|v| v.as_u64())
                .unwrap_or(1);
            let unit_price = 29.99;
            let total_price = unit_price * quantity as f64;

            // Update cart state
            let mut carts = cart_state.lock().unwrap();
            let cart = carts.entry(user_id.clone()).or_insert_with(|| {
                json!({
                    "user_id": user_id,
                    "items": [],
                    "total_items": 0,
                    "total_price": 0.0,
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z"
                })
            });

            // Add item to cart
            let item = json!({
                "food_id": food_id,
                "food_name": "Premium Puppy Food",
                "quantity": quantity,
                "unit_price": unit_price,
                "total_price": total_price,
                "added_at": "2024-01-01T00:00:00Z"
            });

            cart["items"].as_array_mut().unwrap().push(item.clone());
            cart["total_items"] = json!(cart["items"].as_array().unwrap().len());
            cart["total_price"] = json!(cart["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["total_price"].as_f64().unwrap_or(0.0))
                .sum::<f64>());

            (StatusCode::CREATED, Json(item)).into_response()
        }
        _ => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "Food not found"
            })),
        )
            .into_response(),
    }
}

async fn mock_update_cart_item(
    Path((user_id, food_id)): Path<(String, String)>,
    Extension(cart_state): Extension<CartState>,
    ExtractJson(payload): ExtractJson<serde_json::Value>,
) -> Response {
    let quantity = payload
        .get("quantity")
        .and_then(|v| v.as_u64())
        .unwrap_or(1);
    let unit_price = 29.99;
    let total_price = unit_price * quantity as f64;

    // Update cart state
    let mut carts = cart_state.lock().unwrap();
    if let Some(cart) = carts.get_mut(&user_id) {
        if let Some(items) = cart["items"].as_array_mut() {
            for item in items.iter_mut() {
                if item["food_id"].as_str() == Some(&food_id) {
                    item["quantity"] = json!(quantity);
                    item["total_price"] = json!(total_price);
                    break;
                }
            }
            // Calculate totals
            let total_items: u64 = items
                .iter()
                .map(|item| item["quantity"].as_u64().unwrap_or(0))
                .sum();
            let total_price_sum: f64 = items
                .iter()
                .map(|item| item["total_price"].as_f64().unwrap_or(0.0))
                .sum();

            // Update cart totals
            cart["total_items"] = json!(total_items);
            cart["total_price"] = json!(total_price_sum);
        }
    }

    Json(json!({
        "food_id": food_id,
        "food_name": "Premium Puppy Food",
        "quantity": quantity,
        "unit_price": unit_price,
        "total_price": total_price,
        "added_at": "2024-01-01T00:00:00Z"
    }))
    .into_response()
}

async fn mock_delete_cart_item(
    Path((user_id, food_id)): Path<(String, String)>,
    Extension(cart_state): Extension<CartState>,
) -> Response {
    // Remove item from cart state
    let mut carts = cart_state.lock().unwrap();
    if let Some(cart) = carts.get_mut(&user_id) {
        if let Some(items) = cart["items"].as_array_mut() {
            items.retain(|item| item["food_id"].as_str() != Some(&food_id));
            // Calculate totals
            let total_items: u64 = items
                .iter()
                .map(|item| item["quantity"].as_u64().unwrap_or(0))
                .sum();
            let total_price_sum: f64 = items
                .iter()
                .map(|item| item["total_price"].as_f64().unwrap_or(0.0))
                .sum();

            // Update cart totals
            cart["total_items"] = json!(total_items);
            cart["total_price"] = json!(total_price_sum);
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn mock_delete_cart(
    Path(user_id): Path<String>,
    Extension(cart_state): Extension<CartState>,
) -> Response {
    let mut carts = cart_state.lock().unwrap();
    carts.remove(&user_id);
    StatusCode::NO_CONTENT.into_response()
}

async fn mock_create_food(ExtractJson(payload): ExtractJson<serde_json::Value>) -> Response {
    // Validate that required fields are present
    if payload.get("name").is_none() || payload.get("pet_type").is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Missing required fields"
            })),
        )
            .into_response();
    }

    // Return a mock created food
    let created_food = json!({
        "id": "F12345678",
        "name": payload.get("name").unwrap_or(&json!("Test Food")),
        "pet_type": payload.get("pet_type").unwrap_or(&json!("puppy")),
        "food_type": payload.get("food_type").unwrap_or(&json!("dry")),
        "description": payload.get("description").unwrap_or(&json!("Test description")),
        "price": payload.get("price").unwrap_or(&json!(15.99)),
        "image": "https://example.com/petfood/test-food.jpg",
        "ingredients": payload.get("ingredients").unwrap_or(&json!(["chicken", "rice"])),
        "feeding_guidelines": payload.get("feeding_guidelines"),
        "nutritional_info": payload.get("nutritional_info"),
        "availability_status": "instock",
        "stock_quantity": payload.get("stock_quantity").unwrap_or(&json!(100)),
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "is_active": true
    });

    (StatusCode::CREATED, Json(created_food)).into_response()
}

async fn mock_update_food(
    Path(food_id): Path<String>,
    ExtractJson(payload): ExtractJson<serde_json::Value>,
) -> Response {
    if food_id == "F12345678" {
        // Return updated food
        let updated_food = json!({
            "id": food_id,
            "name": payload.get("name").unwrap_or(&json!("Updated Test Puppy Food")),
            "pet_type": "puppy",
            "food_type": "dry",
            "description": payload.get("description").unwrap_or(&json!("An updated test food for puppies")),
            "price": payload.get("price").unwrap_or(&json!(17.99)),
            "image": "https://example.com/petfood/test-food.jpg",
            "ingredients": ["chicken", "rice"],
            "feeding_guidelines": "Feed twice daily",
            "nutritional_info": null,
            "availability_status": "instock",
            "stock_quantity": payload.get("stock_quantity").unwrap_or(&json!(150)),
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "is_active": true
        });

        Json(updated_food).into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "Food not found"
            })),
        )
            .into_response()
    }
}

async fn mock_delete_food(
    Path(food_id): Path<String>,
    Extension(deleted_foods): Extension<FoodState>,
) -> Response {
    if food_id == "F12345678" {
        // Mark food as deleted
        let mut deleted = deleted_foods.lock().unwrap();
        deleted.insert(food_id);
        StatusCode::NO_CONTENT.into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "Food not found"
            })),
        )
            .into_response()
    }
}

fn create_mock_app() -> Router {
    use axum::routing::put;

    let cart_state: CartState = Arc::new(Mutex::new(HashMap::new()));
    let deleted_foods: FoodState = Arc::new(Mutex::new(std::collections::HashSet::new()));

    Router::new()
        .route("/health/status", get(mock_health))
        .route("/api/foods", get(mock_list_foods))
        .route("/api/foods/:food_id", get(mock_get_food))
        .route("/api/admin/foods", post(mock_create_food))
        .route(
            "/api/admin/foods/:food_id",
            put(mock_update_food).delete(mock_delete_food),
        )
        .route(
            "/api/cart/:user_id",
            get(mock_get_cart).delete(mock_delete_cart),
        )
        .route("/api/cart/:user_id/items", post(mock_add_cart_item))
        .route(
            "/api/cart/:user_id/items/:food_id",
            put(mock_update_cart_item).delete(mock_delete_cart_item),
        )
        .route("/api/admin/seed", post(mock_admin_seed))
        .route("/api/admin/cleanup", post(mock_admin_cleanup))
        .layer(Extension(cart_state))
        .layer(Extension(deleted_foods))
}

impl TestEnvironment {
    pub async fn new() -> Self {
        // Create a simple mock app for testing
        let app = create_mock_app();

        // Start server
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("Failed to bind listener");
        let addr = listener.local_addr().expect("Failed to get local address");
        let base_url = format!("http://{}", addr);

        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("Failed to serve app");
        });

        // Wait for server to start
        tokio::time::sleep(Duration::from_millis(100)).await;

        let client = Client::new();

        Self { client, base_url }
    }

    pub async fn seed_test_data(&self) {
        // For mock testing, just call the seed endpoint
        let response = self
            .client
            .post(&format!("{}/api/admin/seed", self.base_url))
            .send()
            .await
            .expect("Failed to seed test data");

        // Use numeric status codes to avoid the StatusCode comparison issue
        assert_eq!(response.status().as_u16(), 200);
    }
}
