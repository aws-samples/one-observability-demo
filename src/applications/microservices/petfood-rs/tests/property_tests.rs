use chrono::Utc;
use petfood_rs::models::{
    validate_cart_quantity, validate_food_name, validate_food_price, AddCartItemRequest,
    AvailabilityStatus, Cart, CartItem, CreateFoodRequest, FoodType, PetType,
};
use proptest::prelude::*;
use rust_decimal::Decimal;

// Property-based test strategies
prop_compose! {
    fn arb_pet_type()(pet_type in prop_oneof![
        Just(PetType::Puppy),
        Just(PetType::Kitten),
        Just(PetType::Bunny),
    ]) -> PetType {
        pet_type
    }
}

prop_compose! {
    fn arb_food_type()(food_type in prop_oneof![
        Just(FoodType::Dry),
        Just(FoodType::Wet),
        Just(FoodType::Treats),
        Just(FoodType::Supplements),
    ]) -> FoodType {
        food_type
    }
}

prop_compose! {
    fn arb_availability_status()(status in prop_oneof![
        Just(AvailabilityStatus::InStock),
        Just(AvailabilityStatus::OutOfStock),
        Just(AvailabilityStatus::Discontinued),
        Just(AvailabilityStatus::PreOrder),
    ]) -> AvailabilityStatus {
        status
    }
}

prop_compose! {
    fn arb_valid_food_name()(name in "[a-zA-Z0-9 ]{3,100}") -> String {
        name
    }
}

prop_compose! {
    fn arb_valid_price()(cents in 1u32..100000) -> Decimal {
        // Generate prices as cents and convert to decimal with exactly 2 decimal places
        Decimal::from_parts(cents, 0, 0, false, 2)
    }
}

prop_compose! {
    fn arb_valid_quantity()(quantity in 1u32..1000) -> u32 {
        quantity
    }
}

prop_compose! {
    fn arb_create_food_request()(
        pet_type in arb_pet_type(),
        name in arb_valid_food_name(),
        food_type in arb_food_type(),
        description in "[a-zA-Z0-9 .,!]{10,500}",
        price in arb_valid_price(),
        ingredients in prop::collection::vec("[a-zA-Z ]{3,20}", 1..10),
        feeding_guidelines in prop::option::of("[a-zA-Z0-9 .,]{10,200}"),
        stock_quantity in arb_valid_quantity(),
    ) -> CreateFoodRequest {
        CreateFoodRequest {
            pet_type,
            name,
            food_type,
            description,
            price,
            // No image field - will be generated via events
            nutritional_info: None,
            ingredients,
            feeding_guidelines,
            stock_quantity,
        }
    }
}

prop_compose! {
    fn arb_add_cart_item_request()(
        food_id in "[a-zA-Z0-9-]{36}",
        quantity in arb_valid_quantity(),
    ) -> AddCartItemRequest {
        AddCartItemRequest {
            food_id,
            quantity,
        }
    }
}

proptest! {
    #[test]
    fn test_food_name_validation(name in ".*") {
        let result = validate_food_name(&name);
        let trimmed = name.trim();

        if !trimmed.is_empty() && trimmed.len() <= 200 && !trimmed.chars().any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t') {
            prop_assert!(result.is_ok());
        } else {
            prop_assert!(result.is_err());
        }
    }

    #[test]
    fn test_price_validation(price_f64 in any::<f64>()) {
        if let Some(price) = Decimal::from_f64_retain(price_f64) {
            let result = validate_food_price(&price);

            // Check if price is in valid range AND has valid precision (max 2 decimal places)
            let min_price = Decimal::from_parts(1, 0, 0, false, 2); // 0.01
            let max_price = Decimal::from(10000);
            let valid_range = price >= min_price && price <= max_price;
            let valid_precision = price.scale() <= 2;

            if valid_range && valid_precision {
                prop_assert!(result.is_ok());
            } else {
                prop_assert!(result.is_err());
            }
        }
    }

    #[test]
    fn test_quantity_validation(quantity in any::<u32>()) {
        let result = validate_cart_quantity(quantity);

        if quantity > 0 && quantity <= 1000 {
            prop_assert!(result.is_ok());
        } else {
            prop_assert!(result.is_err());
        }
    }

    #[test]
    fn test_create_food_request_validation(request in arb_create_food_request()) {
        // All generated requests should be valid
        prop_assert!(validate_food_name(&request.name).is_ok());
        prop_assert!(validate_food_price(&request.price).is_ok());
        prop_assert!(validate_cart_quantity(request.stock_quantity).is_ok());
        prop_assert!(!request.description.is_empty());
        prop_assert!(!request.ingredients.is_empty());
    }

    #[test]
    fn test_cart_item_request_validation(request in arb_add_cart_item_request()) {
        // All generated requests should be valid
        prop_assert!(validate_cart_quantity(request.quantity).is_ok());
        prop_assert!(!request.food_id.is_empty());
    }
}

proptest! {
    #[test]
    fn test_food_serialization_roundtrip(request in arb_create_food_request()) {
        // Test that CreateFoodRequest can be serialized and deserialized
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: CreateFoodRequest = serde_json::from_str(&json).unwrap();

        prop_assert_eq!(request.name, deserialized.name);
        prop_assert_eq!(request.pet_type, deserialized.pet_type);
        prop_assert_eq!(request.food_type, deserialized.food_type);
        prop_assert_eq!(request.price, deserialized.price);
        prop_assert_eq!(request.stock_quantity, deserialized.stock_quantity);
    }

    #[test]
    fn test_cart_operations_invariants(
        user_id in "[a-zA-Z0-9-]{36}",
        items in prop::collection::vec(arb_add_cart_item_request(), 0..10)
    ) {
        // Test cart invariants
        let mut cart = Cart {
            user_id: user_id.clone(),
            items: vec![],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        // Add items to cart
        for item_request in items {
            let cart_item = CartItem {
                food_id: item_request.food_id.clone(),
                quantity: item_request.quantity,
                unit_price: Decimal::from(10), // Fixed price for testing
                added_at: Utc::now(),
            };

            // Check if item already exists
            if let Some(existing_item) = cart.items.iter_mut().find(|i| i.food_id == cart_item.food_id) {
                existing_item.quantity += cart_item.quantity;
            } else {
                cart.items.push(cart_item);
            }
        }

        // Invariants
        prop_assert_eq!(cart.user_id, user_id);
        prop_assert!(cart.items.iter().all(|item| item.quantity > 0));
        prop_assert!(cart.items.iter().all(|item| !item.food_id.is_empty()));

        // No duplicate food_ids
        let mut food_ids: Vec<_> = cart.items.iter().map(|item| &item.food_id).collect();
        food_ids.sort();
        food_ids.dedup();
        prop_assert_eq!(food_ids.len(), cart.items.len());
    }

    #[test]
    fn test_enum_serialization(
        pet_type in arb_pet_type(),
        food_type in arb_food_type(),
        availability in arb_availability_status()
    ) {
        // Test enum serialization/deserialization
        let pet_json = serde_json::to_string(&pet_type).unwrap();
        let pet_deserialized: PetType = serde_json::from_str(&pet_json).unwrap();
        prop_assert_eq!(pet_type, pet_deserialized);

        let food_json = serde_json::to_string(&food_type).unwrap();
        let food_deserialized: FoodType = serde_json::from_str(&food_json).unwrap();
        prop_assert_eq!(food_type, food_deserialized);

        let availability_json = serde_json::to_string(&availability).unwrap();
        let availability_deserialized: AvailabilityStatus = serde_json::from_str(&availability_json).unwrap();
        prop_assert_eq!(availability, availability_deserialized);
    }

    #[test]
    fn test_price_arithmetic_properties(
        price1 in arb_valid_price(),
        price2 in arb_valid_price(),
        quantity in 1u32..100
    ) {
        // Test price arithmetic properties
        let sum = price1 + price2;
        prop_assert!(sum >= price1);
        prop_assert!(sum >= price2);

        let product = price1 * Decimal::from(quantity);
        if quantity > 1 {
            prop_assert!(product > price1);
        } else {
            prop_assert_eq!(product, price1);
        }

        // Test that price operations don't overflow or underflow
        // Decimal in Rust doesn't have is_finite, but operations are safe
        prop_assert!(sum >= Decimal::ZERO);
        prop_assert!(product >= Decimal::ZERO);
    }
}

#[cfg(test)]
mod edge_case_tests {
    use super::*;

    #[test]
    fn test_empty_string_validation() {
        assert!(validate_food_name("").is_err());
        assert!(validate_food_name("  ").is_err());
    }

    #[test]
    fn test_zero_and_negative_values() {
        assert!(validate_food_price(&Decimal::ZERO).is_err()); // Zero is not allowed (minimum is 0.01)
        assert!(validate_food_price(&Decimal::from(-1)).is_err()); // Negative is not allowed
        assert!(validate_cart_quantity(0).is_err()); // Zero quantity not allowed
    }

    #[test]
    fn test_boundary_values() {
        // Test boundary values for food name length (MIN_FOOD_NAME_LENGTH = 1)
        assert!(validate_food_name("").is_err()); // Empty string
        assert!(validate_food_name("a").is_ok()); // Minimum valid (1 char)
        assert!(validate_food_name(&"a".repeat(200)).is_ok()); // Maximum valid (200 chars)
        assert!(validate_food_name(&"a".repeat(201)).is_err()); // Too long

        // Test boundary values for quantity
        assert!(validate_cart_quantity(1).is_ok()); // Minimum valid
        assert!(validate_cart_quantity(1000).is_ok()); // Maximum valid
        assert!(validate_cart_quantity(1001).is_err()); // Too high

        // Test boundary values for price (MIN_PRICE = 0.01, MAX_PRICE = 9999.99)
        assert!(validate_food_price(&Decimal::from_parts(1, 0, 0, false, 2)).is_ok()); // Minimum valid (0.01)
        assert!(validate_food_price(&Decimal::from_parts(999999, 0, 0, false, 2)).is_ok()); // Maximum valid (9999.99)
        assert!(validate_food_price(&Decimal::from(10000)).is_err()); // Too high
    }

    #[test]
    fn test_special_characters_in_names() {
        assert!(validate_food_name("Food with spaces").is_ok());
        assert!(validate_food_name("Food123").is_ok());
        assert!(validate_food_name("Food@#$").is_ok()); // Special characters are allowed
        assert!(validate_food_name("Food\nwith\nnewlines").is_ok()); // Newlines are allowed
        assert!(validate_food_name("Food\x00with\x01control").is_err()); // Control characters not allowed
    }
}
