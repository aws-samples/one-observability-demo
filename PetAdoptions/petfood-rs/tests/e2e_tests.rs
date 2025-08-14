use petfood_rs::models::{Cart, AddCartItemRequest, Food};
use serde_json::json;
use uuid::Uuid;

mod common;
use common::*;

#[tokio::test]
async fn test_complete_user_journey() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    // Step 1: Admin seeds the database with food data
    let response = client
        .post(&format!("{}/api/admin/seed", base_url))
        .send()
        .await
        .expect("Failed to seed data");

    assert_eq!(response.status().as_u16(), 200);

    // Step 2: User gets recommendations for their puppy
    let response = client
        .get(&format!("{}/api/recommendations/puppy", base_url))
        .send()
        .await
        .expect("Failed to get recommendations");

    assert_eq!(response.status().as_u16(), 200);
    let recommendations: serde_json::Value = response.json().await.expect("Failed to parse recommendations");
    let recommended_foods = recommendations["recommendations"].as_array().expect("Expected recommendations array");
    assert!(!recommended_foods.is_empty());

    // Step 3: User searches for specific food types
    let response = client
        .get(&format!("{}/api/foods?food_type=dry&pet_type=puppy", base_url))
        .send()
        .await
        .expect("Failed to search foods");

    assert_eq!(response.status().as_u16(), 200);
    let search_results: serde_json::Value = response.json().await.expect("Failed to parse search results");
    let foods = search_results["foods"].as_array().expect("Expected foods array");
    assert!(!foods.is_empty());

    // Verify all results are dry food for puppies
    for food in foods {
        assert_eq!(food["food_type"], "dry");
        assert_eq!(food["pet_type"], "puppy");
    }

    // Step 4: User views details of a specific food
    let first_food_id = foods[0]["id"].as_str().expect("Expected id");
    let response = client
        .get(&format!("{}/api/foods/{}", base_url, first_food_id))
        .send()
        .await
        .expect("Failed to get food details");

    assert_eq!(response.status().as_u16(), 200);
    let food_details: Food = response.json().await.expect("Failed to parse food details");
    assert_eq!(food_details.id, first_food_id);

    // Step 5: User adds food to their cart
    let user_id = Uuid::new_v4().to_string();
    let add_item_request = AddCartItemRequest {
        food_id: first_food_id.to_string(),
        quantity: 2,
    };

    let response = client
        .post(&format!("{}/api/cart/{}/items", base_url, user_id))
        .json(&add_item_request)
        .send()
        .await
        .expect("Failed to add item to cart");

    assert_eq!(response.status().as_u16(), 201);

    // Step 6: User adds another food to cart
    if foods.len() > 1 {
        let second_food_id = foods[1]["id"].as_str().expect("Expected id");
        let add_item_request = AddCartItemRequest {
            food_id: second_food_id.to_string(),
            quantity: 1,
        };

        let response = client
            .post(&format!("{}/api/cart/{}/items", base_url, user_id))
            .json(&add_item_request)
            .send()
            .await
            .expect("Failed to add second item to cart");

        assert_eq!(response.status().as_u16(), 201);
    }

    // Step 7: User reviews their cart
    let response = client
        .get(&format!("{}/api/cart/{}", base_url, user_id))
        .send()
        .await
        .expect("Failed to get cart");

    assert_eq!(response.status().as_u16(), 200);
    let cart: Cart = response.json().await.expect("Failed to parse cart");
    assert!(!cart.items.is_empty());
    assert!(cart.items.len() >= 1);

    // Step 8: User updates quantity of an item
    let response = client
        .put(&format!("{}/api/cart/{}/items/{}", base_url, user_id, first_food_id))
        .json(&json!({"quantity": 3}))
        .send()
        .await
        .expect("Failed to update cart item");

    assert_eq!(response.status().as_u16(), 200);

    // Step 9: User removes an item from cart
    let response = client
        .delete(&format!("{}/api/cart/{}/items/{}", base_url, user_id, first_food_id))
        .send()
        .await
        .expect("Failed to remove cart item");

    assert_eq!(response.status().as_u16(), 204);

    // Step 10: User clears their cart
    let response = client
        .delete(&format!("{}/api/cart/{}", base_url, user_id))
        .send()
        .await
        .expect("Failed to clear cart");

    assert_eq!(response.status().as_u16(), 204);

    // Verify cart is empty
    let response = client
        .get(&format!("{}/api/cart/{}", base_url, user_id))
        .send()
        .await
        .expect("Failed to get cart");

    let cart: Cart = response.json().await.expect("Failed to parse cart");
    assert!(cart.items.is_empty());
}#[tokio::test]
async fn test_concurrent_user_operations() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    // Seed test data
    test_env.seed_test_data().await;

    // Create multiple users
    let user_ids: Vec<String> = (0..5).map(|_| Uuid::new_v4().to_string()).collect();

    // Get available foods
    let response = client
        .get(&format!("{}/api/foods", base_url))
        .send()
        .await
        .expect("Failed to get foods");

    let foods_response: serde_json::Value = response.json().await.expect("Failed to parse foods");
    let foods = foods_response["foods"].as_array().expect("Expected foods array");
    let food_id = foods[0]["id"].as_str().expect("Expected id");

    // Simulate concurrent cart operations
    let mut handles = vec![];

    for user_id in user_ids {
        let client = client.clone();
        let base_url = base_url.clone();
        let food_id = food_id.to_string();

        let handle = tokio::spawn(async move {
            // Add item to cart
            let add_item_request = AddCartItemRequest {
                food_id: food_id.clone(),
                quantity: 1,
            };

            let response = client
                .post(&format!("{}/api/cart/{}/items", base_url, user_id))
                .json(&add_item_request)
                .send()
                .await
                .expect("Failed to add item to cart");

            assert_eq!(response.status().as_u16(), 201);

            // Get cart
            let response = client
                .get(&format!("{}/api/cart/{}", base_url, user_id))
                .send()
                .await
                .expect("Failed to get cart");

            assert_eq!(response.status().as_u16(), 200);
            let cart: Cart = response.json().await.expect("Failed to parse cart");
            assert_eq!(cart.items.len(), 1);

            // Update quantity
            let response = client
                .put(&format!("{}/api/cart/{}/items/{}", base_url, user_id, food_id))
                .json(&json!({"quantity": 2}))
                .send()
                .await
                .expect("Failed to update cart item");

            assert_eq!(response.status().as_u16(), 200);

            // Clear cart
            let response = client
                .delete(&format!("{}/api/cart/{}", base_url, user_id))
                .send()
                .await
                .expect("Failed to clear cart");

            assert_eq!(response.status().as_u16(), 204);
        });

        handles.push(handle);
    }

    // Wait for all operations to complete
    for handle in handles {
        handle.await.expect("Task failed");
    }
}

#[tokio::test]
async fn test_error_recovery_workflow() {
    let test_env = TestEnvironment::new().await;
    let client = &test_env.client;
    let base_url = &test_env.base_url;

    let user_id = Uuid::new_v4().to_string();

    // Try to get cart for non-existent user (should create empty cart)
    let response = client
        .get(&format!("{}/api/cart/{}", base_url, user_id))
        .send()
        .await
        .expect("Failed to get cart");

    assert_eq!(response.status().as_u16(), 200);
    let cart: Cart = response.json().await.expect("Failed to parse cart");
    assert!(cart.items.is_empty());

    // Try to add non-existent food to cart
    let add_item_request = AddCartItemRequest {
        food_id: "non-existent-food-id".to_string(),
        quantity: 1,
    };

    let response = client
        .post(&format!("{}/api/cart/{}/items", base_url, user_id))
        .json(&add_item_request)
        .send()
        .await
        .expect("Failed to add item to cart");

    assert_eq!(response.status().as_u16(), 404);

    // Try to get recommendations for invalid pet type
    let response = client
        .get(&format!("{}/api/recommendations/invalid-pet", base_url))
        .send()
        .await
        .expect("Failed to get recommendations");

    assert_eq!(response.status().as_u16(), 400);

    // Try to get non-existent food
    let response = client
        .get(&format!("{}/api/foods/non-existent-food", base_url))
        .send()
        .await
        .expect("Failed to get food");

    assert_eq!(response.status().as_u16(), 404);

    // Verify system is still functional after errors
    let response = client
        .get(&format!("{}/health/status", base_url))
        .send()
        .await
        .expect("Failed to get health status");

    assert_eq!(response.status().as_u16(), 200);
}