#![allow(clippy::needless_borrows_for_generic_args)]

use petfood_rs::models::{
    AddCartItemRequest, Cart, CreateFoodRequest, Food, FoodType, PetType, UpdateFoodRequest,
};
use rust_decimal_macros::dec;
use serde_json::json;
use tracing::info;
use uuid::Uuid;

mod common;
use common::*;

#[tokio::test]
async fn test_food_api_endpoints() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    // Test creating a food item
    let create_request = CreateFoodRequest {
        pet_type: PetType::Puppy,
        name: "Test Puppy Food".to_string(),
        food_type: FoodType::Dry,
        description: "A test food for puppies".to_string(),
        price: dec!(15.99),
        image: "test-puppy-food.jpg".to_string(),
        nutritional_info: None,
        ingredients: vec!["chicken".to_string(), "rice".to_string()],
        feeding_guidelines: Some("Feed twice daily".to_string()),
        stock_quantity: 100,
    };

    let response = client
        .post(&format!("{}/api/admin/foods", base_url))
        .json(&create_request)
        .send()
        .await
        .expect("Failed to send request");
    info!("{}", response.status().as_u16().to_string());

    assert_eq!(response.status().as_u16(), 201);
    let created_food: Food = response.json().await.expect("Failed to parse response");
    assert_eq!(created_food.name, "Test Puppy Food");

    // Test getting the created food
    let response = client
        .get(&format!("{}/api/foods/{}", base_url, created_food.id))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);
    let retrieved_food: Food = response.json().await.expect("Failed to parse response");
    assert_eq!(retrieved_food.id, created_food.id);

    // Test listing foods
    let response = client
        .get(&format!("{}/api/foods", base_url))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);
    let foods_response: serde_json::Value =
        response.json().await.expect("Failed to parse response");
    let foods = foods_response["foods"]
        .as_array()
        .expect("Expected foods array");
    assert!(!foods.is_empty());

    // Test updating the food
    let update_request = UpdateFoodRequest {
        name: Some("Updated Test Puppy Food".to_string()),
        description: Some("An updated test food for puppies".to_string()),
        price: Some(dec!(17.99)),
        stock_quantity: Some(150),
        ..Default::default()
    };

    let response = client
        .put(&format!("{}/api/admin/foods/{}", base_url, created_food.id))
        .json(&update_request)
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);
    let updated_food: Food = response.json().await.expect("Failed to parse response");
    assert_eq!(updated_food.name, "Updated Test Puppy Food");
    assert_eq!(updated_food.price, dec!(17.99));

    // Test deleting the food
    let response = client
        .delete(&format!("{}/api/admin/foods/{}", base_url, created_food.id))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 204);

    // Verify food is soft deleted (should return 404 for regular get)
    let response = client
        .get(&format!("{}/api/foods/{}", base_url, created_food.id))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 404);
}

#[tokio::test]
async fn test_recommendation_endpoints() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    // Seed some test data first
    test_env.seed_test_data().await;

    // Test getting recommendations for puppy
    let response = client
        .get(&format!("{}/api/recommendations/puppy", base_url))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);
    let recommendations: serde_json::Value =
        response.json().await.expect("Failed to parse response");
    let foods = recommendations["recommendations"]
        .as_array()
        .expect("Expected recommendations array");
    assert!(!foods.is_empty());

    // Verify all recommendations are for puppies
    for food in foods {
        assert_eq!(food["pet_type"], "puppy");
    }

    // Test getting recommendations for invalid pet type
    let response = client
        .get(&format!("{}/api/recommendations/invalid", base_url))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 400);
}
#[tokio::test]
async fn test_cart_endpoints() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    // Seed some test data first
    test_env.seed_test_data().await;
    let user_id = Uuid::new_v4().to_string();

    // Get available foods to add to cart
    let response = client
        .get(&format!("{}/api/foods", base_url))
        .send()
        .await
        .expect("Failed to send request");

    let foods_response: serde_json::Value =
        response.json().await.expect("Failed to parse response");
    let foods = foods_response["foods"]
        .as_array()
        .expect("Expected foods array");
    let first_food = &foods[0];
    let food_id = first_food["id"].as_str().expect("Expected id");

    // Test adding item to cart
    let add_item_request = AddCartItemRequest {
        food_id: food_id.to_string(),
        quantity: 2,
    };

    let response = client
        .post(&format!("{}/api/cart/{}/items", base_url, user_id))
        .json(&add_item_request)
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 201);

    // Test getting cart
    let response = client
        .get(&format!("{}/api/cart/{}", base_url, user_id))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);
    let cart: Cart = response.json().await.expect("Failed to parse response");
    assert_eq!(cart.items.len(), 1);
    assert_eq!(cart.items[0].food_id, food_id);
    assert_eq!(cart.items[0].quantity, 2);

    // Test updating cart item quantity
    let response = client
        .put(&format!(
            "{}/api/cart/{}/items/{}",
            base_url, user_id, food_id
        ))
        .json(&json!({"quantity": 5}))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);

    // Verify quantity was updated
    let response = client
        .get(&format!("{}/api/cart/{}", base_url, user_id))
        .send()
        .await
        .expect("Failed to send request");

    let cart: Cart = response.json().await.expect("Failed to parse response");
    assert_eq!(cart.items[0].quantity, 5);

    // Test removing item from cart
    let response = client
        .delete(&format!(
            "{}/api/cart/{}/items/{}",
            base_url, user_id, food_id
        ))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 204);

    // Verify item was removed
    let response = client
        .get(&format!("{}/api/cart/{}", base_url, user_id))
        .send()
        .await
        .expect("Failed to send request");

    let cart: Cart = response.json().await.expect("Failed to parse response");
    assert!(cart.items.is_empty());
}
#[tokio::test]
async fn test_health_endpoint() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    let response = client
        .get(&format!("{}/health/status", base_url))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);
    let health_response: serde_json::Value =
        response.json().await.expect("Failed to parse response");
    assert_eq!(health_response["status"], "healthy");
}

#[tokio::test]
async fn test_admin_endpoints() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    // Test seeding data
    let response = client
        .post(&format!("{}/api/admin/seed", base_url))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);
    let seed_response: serde_json::Value = response.json().await.expect("Failed to parse response");
    assert!(seed_response["foods_created"].as_u64().unwrap() > 0);

    // Verify data was seeded
    let response = client
        .get(&format!("{}/api/foods", base_url))
        .send()
        .await
        .expect("Failed to send request");

    let foods_response: serde_json::Value =
        response.json().await.expect("Failed to parse response");
    let foods = foods_response["foods"]
        .as_array()
        .expect("Expected foods array");
    assert!(!foods.is_empty());

    // Test cleanup
    let response = client
        .post(&format!("{}/api/admin/cleanup", base_url))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 200);

    // Verify data was cleaned up
    let response = client
        .get(&format!("{}/api/foods", base_url))
        .send()
        .await
        .expect("Failed to send request");

    let foods_response: serde_json::Value =
        response.json().await.expect("Failed to parse response");
    let foods = foods_response["foods"]
        .as_array()
        .expect("Expected foods array");
    assert!(foods.is_empty());
}

#[tokio::test]
async fn test_error_handling() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    // Test 404 for non-existent food
    let response = client
        .get(&format!("{}/api/foods/non-existent-id", base_url))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 404);

    // Test 400 for invalid request body
    let invalid_request = json!({
        "invalid_field": "invalid_value"
    });

    let response = client
        .post(&format!("{}/api/admin/foods", base_url))
        .json(&invalid_request)
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(response.status().as_u16(), 400);
}
