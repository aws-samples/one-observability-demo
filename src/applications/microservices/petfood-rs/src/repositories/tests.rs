#[cfg(test)]
mod repository_tests {
    use crate::models::{
        AvailabilityStatus, Cart, CreateFoodRequest, Food, FoodType, NutritionalInfo, PetType,
        RepositoryError,
    };
    use aws_sdk_dynamodb::types::AttributeValue;
    use rust_decimal_macros::dec;
    use std::collections::HashMap;
    use std::sync::Arc;

    use crate::repositories::cart_repository::*;
    use crate::repositories::food_repository::*;

    fn create_test_client() -> Arc<aws_sdk_dynamodb::Client> {
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        Arc::new(aws_sdk_dynamodb::Client::from_conf(config))
    }

    fn create_test_food() -> Food {
        let request = CreateFoodRequest {
            pet_type: PetType::Puppy,
            name: "Premium Puppy Kibble".to_string(),
            food_type: FoodType::Dry,
            description: "High-quality dry food for growing puppies".to_string(),
            price: dec!(24.99),
            image: "puppy-kibble.jpg".to_string(),
            nutritional_info: Some(NutritionalInfo {
                calories_per_serving: Some(380),
                protein_percentage: Some(dec!(28.0)),
                fat_percentage: Some(dec!(18.0)),
                carbohydrate_percentage: Some(dec!(42.0)),
                fiber_percentage: Some(dec!(4.0)),
                moisture_percentage: Some(dec!(8.0)),
                serving_size: Some("1 cup".to_string()),
                servings_per_container: Some(30),
            }),
            ingredients: vec![
                "chicken meal".to_string(),
                "brown rice".to_string(),
                "sweet potato".to_string(),
                "chicken fat".to_string(),
            ],
            feeding_guidelines: Some("Feed 1-2 cups daily based on weight".to_string()),
            stock_quantity: 50,
        };
        Food::new(request)
    }

    fn create_test_cart() -> Cart {
        let mut cart = Cart::new("test-user-123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(24.99));
        cart.add_item("F002".to_string(), 1, dec!(15.50));
        cart.add_item("F003".to_string(), 3, dec!(8.99));
        cart
    }

    mod food_repository_tests {
        use super::*;

        #[test]
        fn test_food_to_item_conversion_complete() {
            let food = create_test_food();
            let client = create_test_client();
            let repo = DynamoDbFoodRepository::new(client, "test-foods".to_string());
            let item = repo.food_to_item(&food);

            // Verify all required fields are present
            assert!(item.contains_key("id"));
            assert!(item.contains_key("pet_type"));
            assert!(item.contains_key("name"));
            assert!(item.contains_key("food_type"));
            assert!(item.contains_key("description"));
            assert!(item.contains_key("price"));
            assert!(item.contains_key("image"));
            assert!(item.contains_key("nutritional_info"));
            assert!(item.contains_key("ingredients"));
            assert!(item.contains_key("feeding_guidelines"));
            assert!(item.contains_key("availability_status"));
            assert!(item.contains_key("stock_quantity"));
            assert!(item.contains_key("created_at"));
            assert!(item.contains_key("updated_at"));
            assert!(item.contains_key("is_active"));

            // Verify specific values
            if let Some(AttributeValue::S(pet_type)) = item.get("pet_type") {
                assert_eq!(pet_type, "puppy");
            } else {
                panic!("Expected string value for pet_type");
            }

            if let Some(AttributeValue::N(price)) = item.get("price") {
                assert_eq!(price, "24.99");
            } else {
                panic!("Expected number value for price");
            }

            if let Some(AttributeValue::L(ingredients)) = item.get("ingredients") {
                assert_eq!(ingredients.len(), 4);
                if let AttributeValue::S(first_ingredient) = &ingredients[0] {
                    assert_eq!(first_ingredient, "chicken meal");
                }
            } else {
                panic!("Expected list value for ingredients");
            }

            if let Some(AttributeValue::M(nutrition)) = item.get("nutritional_info") {
                assert!(nutrition.contains_key("calories_per_serving"));
                assert!(nutrition.contains_key("protein_percentage"));

                if let Some(AttributeValue::N(calories)) = nutrition.get("calories_per_serving") {
                    assert_eq!(calories, "380");
                }
            } else {
                panic!("Expected map value for nutritional_info");
            }

            if let Some(AttributeValue::Bool(active)) = item.get("is_active") {
                assert!(active);
            } else {
                panic!("Expected boolean value for is_active");
            }
        }

        #[test]
        fn test_item_to_food_conversion_roundtrip() {
            let original_food = create_test_food();
            let client = create_test_client();

            let repo = DynamoDbFoodRepository::new(client, "test-foods".to_string());

            // Convert to item and back
            let item = repo.food_to_item(&original_food);
            let converted_food = repo.item_to_food(item).unwrap();

            // Verify all fields match
            assert_eq!(converted_food.id, original_food.id);
            assert_eq!(converted_food.pet_type, original_food.pet_type);
            assert_eq!(converted_food.name, original_food.name);
            assert_eq!(converted_food.food_type, original_food.food_type);
            assert_eq!(converted_food.description, original_food.description);
            assert_eq!(converted_food.price, original_food.price);
            assert_eq!(converted_food.image, original_food.image);
            assert_eq!(converted_food.ingredients, original_food.ingredients);
            assert_eq!(
                converted_food.feeding_guidelines,
                original_food.feeding_guidelines
            );
            assert_eq!(
                converted_food.availability_status,
                original_food.availability_status
            );
            assert_eq!(converted_food.stock_quantity, original_food.stock_quantity);
            assert_eq!(converted_food.is_active, original_food.is_active);

            // Verify nutritional info
            assert!(converted_food.nutritional_info.is_some());
            let converted_nutrition = converted_food.nutritional_info.unwrap();
            let original_nutrition = original_food.nutritional_info.unwrap();

            assert_eq!(
                converted_nutrition.calories_per_serving,
                original_nutrition.calories_per_serving
            );
            assert_eq!(
                converted_nutrition.protein_percentage,
                original_nutrition.protein_percentage
            );
            assert_eq!(
                converted_nutrition.fat_percentage,
                original_nutrition.fat_percentage
            );
            assert_eq!(
                converted_nutrition.serving_size,
                original_nutrition.serving_size
            );
            assert_eq!(
                converted_nutrition.servings_per_container,
                original_nutrition.servings_per_container
            );

            // Timestamps should be preserved (within reasonable precision)
            let created_diff = (converted_food.created_at - original_food.created_at)
                .num_milliseconds()
                .abs();
            let updated_diff = (converted_food.updated_at - original_food.updated_at)
                .num_milliseconds()
                .abs();

            assert!(
                created_diff < 1000,
                "Created timestamp difference too large: {}ms",
                created_diff
            );
            assert!(
                updated_diff < 1000,
                "Updated timestamp difference too large: {}ms",
                updated_diff
            );
        }

        #[test]
        fn test_food_without_optional_fields() {
            let request = CreateFoodRequest {
                pet_type: PetType::Kitten,
                name: "Basic Cat Food".to_string(),
                food_type: FoodType::Wet,
                description: "Simple wet food for kittens".to_string(),
                price: dec!(5.99),
                image: "basic-cat.jpg".to_string(),
                nutritional_info: None,
                ingredients: vec!["fish".to_string()],
                feeding_guidelines: None,
                stock_quantity: 0,
            };

            let food = Food::new(request);
            let client = create_test_client();

            let repo = DynamoDbFoodRepository::new(client, "test-foods".to_string());

            let item = repo.food_to_item(&food);
            let converted_food = repo.item_to_food(item).unwrap();

            assert_eq!(converted_food.name, "Basic Cat Food");
            assert_eq!(converted_food.pet_type, PetType::Kitten);
            assert_eq!(
                converted_food.availability_status,
                AvailabilityStatus::OutOfStock
            );
            assert!(converted_food.nutritional_info.is_none());
            assert!(converted_food.feeding_guidelines.is_none());
            assert_eq!(converted_food.stock_quantity, 0);
        }

        #[test]
        fn test_repository_index_names() {
            let client = create_test_client();

            let repo = DynamoDbFoodRepository::new(client, "PetFoods".to_string());

            assert_eq!(repo.table_name(), "PetFoods");
            assert_eq!(repo.pet_type_index(), "PetTypeIndex");
            assert_eq!(repo.food_type_index(), "FoodTypeIndex");
        }
    }

    mod cart_repository_tests {
        use super::*;

        #[test]
        fn test_cart_to_item_conversion_complete() {
            let cart = create_test_cart();
            let client = create_test_client();

            let repo = DynamoDbCartRepository::new(client, "test-carts".to_string());
            let item = repo.cart_to_item(&cart);

            // Verify all required fields are present
            assert!(item.contains_key("user_id"));
            assert!(item.contains_key("items"));
            assert!(item.contains_key("created_at"));
            assert!(item.contains_key("updated_at"));

            // Verify user_id
            if let Some(AttributeValue::S(user_id)) = item.get("user_id") {
                assert_eq!(user_id, "test-user-123");
            } else {
                panic!("Expected string value for user_id");
            }

            // Verify items structure
            if let Some(AttributeValue::L(items)) = item.get("items") {
                assert_eq!(items.len(), 3);

                // Check first item structure
                if let AttributeValue::M(first_item) = &items[0] {
                    assert!(first_item.contains_key("food_id"));
                    assert!(first_item.contains_key("quantity"));
                    assert!(first_item.contains_key("unit_price"));
                    assert!(first_item.contains_key("added_at"));

                    if let Some(AttributeValue::S(food_id)) = first_item.get("food_id") {
                        assert_eq!(food_id, "F001");
                    }

                    if let Some(AttributeValue::N(quantity)) = first_item.get("quantity") {
                        assert_eq!(quantity, "2");
                    }

                    if let Some(AttributeValue::N(price)) = first_item.get("unit_price") {
                        assert_eq!(price, "24.99");
                    }
                } else {
                    panic!("Expected map value for cart item");
                }
            } else {
                panic!("Expected list value for items");
            }
        }

        #[test]
        fn test_item_to_cart_conversion_roundtrip() {
            let original_cart = create_test_cart();
            let client = create_test_client();

            let repo = DynamoDbCartRepository::new(client, "test-carts".to_string());

            // Convert to item and back
            let item = repo.cart_to_item(&original_cart);
            let converted_cart = repo.item_to_cart(item).unwrap();

            // Verify basic fields
            assert_eq!(converted_cart.user_id, original_cart.user_id);
            assert_eq!(converted_cart.items.len(), original_cart.items.len());

            // Verify each cart item
            for (i, (original_item, converted_item)) in original_cart
                .items
                .iter()
                .zip(converted_cart.items.iter())
                .enumerate()
            {
                assert_eq!(
                    converted_item.food_id, original_item.food_id,
                    "Item {} food_id mismatch",
                    i
                );
                assert_eq!(
                    converted_item.quantity, original_item.quantity,
                    "Item {} quantity mismatch",
                    i
                );
                assert_eq!(
                    converted_item.unit_price, original_item.unit_price,
                    "Item {} price mismatch",
                    i
                );

                // Timestamps should be preserved (within reasonable precision)
                let time_diff = (converted_item.added_at - original_item.added_at)
                    .num_milliseconds()
                    .abs();
                assert!(
                    time_diff < 1000,
                    "Item {} timestamp difference too large: {}ms",
                    i,
                    time_diff
                );
            }

            // Verify cart totals
            assert_eq!(converted_cart.total_items(), original_cart.total_items());
            assert_eq!(converted_cart.total_price(), original_cart.total_price());

            // Timestamps should be preserved
            let created_diff = (converted_cart.created_at - original_cart.created_at)
                .num_milliseconds()
                .abs();
            let updated_diff = (converted_cart.updated_at - original_cart.updated_at)
                .num_milliseconds()
                .abs();

            assert!(
                created_diff < 1000,
                "Created timestamp difference too large: {}ms",
                created_diff
            );
            assert!(
                updated_diff < 1000,
                "Updated timestamp difference too large: {}ms",
                updated_diff
            );
        }

        #[test]
        fn test_empty_cart_conversion() {
            let empty_cart = Cart::new("empty-user".to_string());
            let client = create_test_client();

            let repo = DynamoDbCartRepository::new(client, "test-carts".to_string());

            let item = repo.cart_to_item(&empty_cart);
            let converted_cart = repo.item_to_cart(item).unwrap();

            assert_eq!(converted_cart.user_id, "empty-user");
            assert!(converted_cart.items.is_empty());
            assert_eq!(converted_cart.total_items(), 0);
            assert_eq!(converted_cart.total_price(), dec!(0));
        }

        #[test]
        fn test_map_to_cart_item_valid() {
            let client = create_test_client();

            let repo = DynamoDbCartRepository::new(client, "test-carts".to_string());

            let mut item_map = HashMap::new();
            item_map.insert("food_id".to_string(), AttributeValue::S("F123".to_string()));
            item_map.insert("quantity".to_string(), AttributeValue::N("5".to_string()));
            item_map.insert(
                "unit_price".to_string(),
                AttributeValue::N("19.99".to_string()),
            );
            item_map.insert(
                "added_at".to_string(),
                AttributeValue::S(chrono::Utc::now().to_rfc3339()),
            );

            let cart_item = repo.map_to_cart_item(&item_map).unwrap();

            assert_eq!(cart_item.food_id, "F123");
            assert_eq!(cart_item.quantity, 5);
            assert_eq!(cart_item.unit_price, dec!(19.99));
            assert_eq!(cart_item.total_price(), dec!(99.95));
        }

        #[test]
        fn test_map_to_cart_item_missing_fields() {
            let client = create_test_client();

            let repo = DynamoDbCartRepository::new(client, "test-carts".to_string());

            // Test missing food_id
            let mut incomplete_map = HashMap::new();
            incomplete_map.insert("quantity".to_string(), AttributeValue::N("2".to_string()));
            incomplete_map.insert(
                "unit_price".to_string(),
                AttributeValue::N("10.00".to_string()),
            );

            let result = repo.map_to_cart_item(&incomplete_map);
            assert!(result.is_err());

            if let Err(RepositoryError::InvalidQuery { message }) = result {
                assert!(message.contains("Missing food_id"));
            } else {
                panic!("Expected InvalidQuery error for missing food_id");
            }
        }

        #[test]
        fn test_map_to_cart_item_invalid_types() {
            let client = create_test_client();

            let repo = DynamoDbCartRepository::new(client, "test-carts".to_string());

            // Test invalid quantity (string instead of number)
            let mut invalid_map = HashMap::new();
            invalid_map.insert("food_id".to_string(), AttributeValue::S("F123".to_string()));
            invalid_map.insert(
                "quantity".to_string(),
                AttributeValue::S("not-a-number".to_string()),
            );
            invalid_map.insert(
                "unit_price".to_string(),
                AttributeValue::N("10.00".to_string()),
            );
            invalid_map.insert(
                "added_at".to_string(),
                AttributeValue::S(chrono::Utc::now().to_rfc3339()),
            );

            let result = repo.map_to_cart_item(&invalid_map);
            assert!(result.is_err());
        }
    }

    pub mod integration_test_helpers {
        use super::*;

        /// Helper function to create test data for integration tests
        #[allow(dead_code)]
        pub fn create_sample_foods() -> Vec<Food> {
            vec![
                create_puppy_food(),
                create_kitten_food(),
                create_bunny_food(),
            ]
        }

        #[allow(dead_code)]
        fn create_puppy_food() -> Food {
            let request = CreateFoodRequest {
                pet_type: PetType::Puppy,
                name: "Puppy Growth Formula".to_string(),
                food_type: FoodType::Dry,
                description: "Complete nutrition for growing puppies".to_string(),
                price: dec!(29.99),
                image: "puppy-growth.jpg".to_string(),
                nutritional_info: Some(NutritionalInfo {
                    calories_per_serving: Some(420),
                    protein_percentage: Some(dec!(30.0)),
                    fat_percentage: Some(dec!(20.0)),
                    carbohydrate_percentage: Some(dec!(38.0)),
                    fiber_percentage: Some(dec!(4.0)),
                    moisture_percentage: Some(dec!(8.0)),
                    serving_size: Some("1.5 cups".to_string()),
                    servings_per_container: Some(25),
                }),
                ingredients: vec![
                    "deboned chicken".to_string(),
                    "chicken meal".to_string(),
                    "sweet potato".to_string(),
                    "peas".to_string(),
                ],
                feeding_guidelines: Some("Feed 2-3 times daily".to_string()),
                stock_quantity: 100,
            };
            Food::new(request)
        }

        #[allow(dead_code)]
        fn create_kitten_food() -> Food {
            let request = CreateFoodRequest {
                pet_type: PetType::Kitten,
                name: "Kitten Salmon Pate".to_string(),
                food_type: FoodType::Wet,
                description: "Rich salmon pate for growing kittens".to_string(),
                price: dec!(1.99),
                image: "kitten-salmon.jpg".to_string(),
                nutritional_info: None,
                ingredients: vec![
                    "salmon".to_string(),
                    "chicken broth".to_string(),
                    "carrots".to_string(),
                ],
                feeding_guidelines: Some("Feed 3-4 cans daily".to_string()),
                stock_quantity: 200,
            };
            Food::new(request)
        }

        #[allow(dead_code)]
        fn create_bunny_food() -> Food {
            let request = CreateFoodRequest {
                pet_type: PetType::Bunny,
                name: "Timothy Hay Pellets".to_string(),
                food_type: FoodType::Dry,
                description: "High-fiber pellets made from timothy hay".to_string(),
                price: dec!(12.50),
                image: "bunny-pellets.jpg".to_string(),
                nutritional_info: Some(NutritionalInfo {
                    calories_per_serving: Some(250),
                    protein_percentage: Some(dec!(14.0)),
                    fat_percentage: Some(dec!(3.0)),
                    carbohydrate_percentage: Some(dec!(45.0)),
                    fiber_percentage: Some(dec!(25.0)),
                    moisture_percentage: Some(dec!(13.0)),
                    serving_size: Some("1/4 cup".to_string()),
                    servings_per_container: Some(80),
                }),
                ingredients: vec![
                    "timothy hay".to_string(),
                    "alfalfa meal".to_string(),
                    "wheat middlings".to_string(),
                ],
                feeding_guidelines: Some("Feed 1/4 cup per 5 lbs body weight".to_string()),
                stock_quantity: 75,
            };
            Food::new(request)
        }

        /// Helper to create a cart with mixed items
        #[allow(dead_code)]
        pub fn create_mixed_cart() -> Cart {
            let mut cart = Cart::new("integration-test-user".to_string());
            cart.add_item("F001".to_string(), 1, dec!(29.99)); // Puppy food
            cart.add_item("F002".to_string(), 6, dec!(1.99)); // Kitten food (6 cans)
            cart.add_item("F003".to_string(), 2, dec!(12.50)); // Bunny food
            cart
        }
    }
}

// Re-export test helpers for integration tests
// #[cfg(test)]
// pub use repository_tests::integration_test_helpers;
