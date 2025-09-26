use rust_decimal::Decimal;
use std::collections::HashSet;

use super::{
    AddCartItemRequest, CreateFoodRequest, UpdateCartItemRequest, UpdateFoodRequest,
    ValidationError, ValidationResult,
};

/// Trait for validating input models
pub trait Validate {
    fn validate(&self) -> ValidationResult<()>;
}

/// Validation constants
pub const MAX_FOOD_NAME_LENGTH: usize = 200;
pub const MIN_FOOD_NAME_LENGTH: usize = 1;
pub const MAX_DESCRIPTION_LENGTH: usize = 1000;
pub const MIN_DESCRIPTION_LENGTH: usize = 10;
pub const MAX_INGREDIENT_LENGTH: usize = 100;
pub const MAX_INGREDIENTS_COUNT: usize = 50;
pub const MAX_FEEDING_GUIDELINES_LENGTH: usize = 500;
pub const MAX_IMAGE_URL_LENGTH: usize = 500;
pub const MIN_PRICE: Decimal = Decimal::from_parts(1, 0, 0, false, 2); // 0.01
pub const MAX_PRICE: Decimal = Decimal::from_parts(999999, 0, 0, false, 2); // 9999.99
pub const MAX_STOCK_QUANTITY: u32 = 999999;
pub const MAX_CART_QUANTITY: u32 = 1000;
pub const MIN_CART_QUANTITY: u32 = 1;

impl Validate for CreateFoodRequest {
    fn validate(&self) -> ValidationResult<()> {
        validate_food_name(&self.name)?;
        validate_food_description(&self.description)?;
        validate_food_price(&self.price)?;
        // Image validation removed - images are generated via events
        validate_ingredients(&self.ingredients)?;
        validate_feeding_guidelines(&self.feeding_guidelines)?;
        validate_stock_quantity(self.stock_quantity)?;
        Ok(())
    }
}

impl Validate for UpdateFoodRequest {
    fn validate(&self) -> ValidationResult<()> {
        if let Some(name) = &self.name {
            validate_food_name(name)?;
        }
        if let Some(description) = &self.description {
            validate_food_description(description)?;
        }
        if let Some(price) = &self.price {
            validate_food_price(price)?;
        }
        if let Some(ingredients) = &self.ingredients {
            validate_ingredients(ingredients)?;
        }
        validate_feeding_guidelines(&self.feeding_guidelines)?;
        if let Some(stock) = self.stock_quantity {
            validate_stock_quantity(stock)?;
        }
        Ok(())
    }
}

impl Validate for AddCartItemRequest {
    fn validate(&self) -> ValidationResult<()> {
        validate_food_id(&self.food_id)?;
        validate_cart_quantity(self.quantity)?;
        Ok(())
    }
}

impl Validate for UpdateCartItemRequest {
    fn validate(&self) -> ValidationResult<()> {
        validate_cart_quantity(self.quantity)?;
        Ok(())
    }
}

/// Validate food name
pub fn validate_food_name(name: &str) -> ValidationResult<()> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(ValidationError::RequiredField {
            field: "food_name".to_string(),
        });
    }

    if trimmed.len() < MIN_FOOD_NAME_LENGTH {
        return Err(ValidationError::TooShort {
            field: "food_name".to_string(),
            min_length: MIN_FOOD_NAME_LENGTH,
            actual_length: trimmed.len(),
        });
    }

    if trimmed.len() > MAX_FOOD_NAME_LENGTH {
        return Err(ValidationError::TooLong {
            field: "food_name".to_string(),
            max_length: MAX_FOOD_NAME_LENGTH,
            actual_length: trimmed.len(),
        });
    }

    // Check for invalid characters (basic validation)
    if trimmed
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err(ValidationError::InvalidValue {
            field: "food_name".to_string(),
            value: name.to_string(),
            reason: "Contains invalid control characters".to_string(),
        });
    }

    Ok(())
}

/// Validate food description
pub fn validate_food_description(description: &str) -> ValidationResult<()> {
    let trimmed = description.trim();

    if trimmed.is_empty() {
        return Err(ValidationError::RequiredField {
            field: "food_description".to_string(),
        });
    }

    if trimmed.len() < MIN_DESCRIPTION_LENGTH {
        return Err(ValidationError::TooShort {
            field: "food_description".to_string(),
            min_length: MIN_DESCRIPTION_LENGTH,
            actual_length: trimmed.len(),
        });
    }

    if trimmed.len() > MAX_DESCRIPTION_LENGTH {
        return Err(ValidationError::TooLong {
            field: "food_description".to_string(),
            max_length: MAX_DESCRIPTION_LENGTH,
            actual_length: trimmed.len(),
        });
    }

    Ok(())
}

/// Validate food price
pub fn validate_food_price(price: &Decimal) -> ValidationResult<()> {
    if *price < MIN_PRICE {
        return Err(ValidationError::OutOfRange {
            field: "food_price".to_string(),
            min: MIN_PRICE.to_string(),
            max: MAX_PRICE.to_string(),
            value: price.to_string(),
        });
    }

    if *price > MAX_PRICE {
        return Err(ValidationError::OutOfRange {
            field: "food_price".to_string(),
            min: MIN_PRICE.to_string(),
            max: MAX_PRICE.to_string(),
            value: price.to_string(),
        });
    }

    // Check for reasonable decimal places (max 2)
    if price.scale() > 2 {
        return Err(ValidationError::InvalidValue {
            field: "food_price".to_string(),
            value: price.to_string(),
            reason: "Price cannot have more than 2 decimal places".to_string(),
        });
    }

    Ok(())
}

/// Validate food image URL
pub fn validate_food_image(image: &str) -> ValidationResult<()> {
    let trimmed = image.trim();

    if trimmed.is_empty() {
        return Err(ValidationError::RequiredField {
            field: "food_image".to_string(),
        });
    }

    if trimmed.len() > MAX_IMAGE_URL_LENGTH {
        return Err(ValidationError::TooLong {
            field: "food_image".to_string(),
            max_length: MAX_IMAGE_URL_LENGTH,
            actual_length: trimmed.len(),
        });
    }

    // Basic URL format validation
    if !trimmed.ends_with(".jpg")
        && !trimmed.ends_with(".jpeg")
        && !trimmed.ends_with(".png")
        && !trimmed.ends_with(".webp")
    {
        return Err(ValidationError::InvalidFormat {
            field: "food_image".to_string(),
            expected: "Valid image file extension (.jpg, .jpeg, .png, .webp)".to_string(),
        });
    }

    Ok(())
}

/// Validate ingredients list
pub fn validate_ingredients(ingredients: &[String]) -> ValidationResult<()> {
    if ingredients.is_empty() {
        return Err(ValidationError::RequiredField {
            field: "ingredients".to_string(),
        });
    }

    if ingredients.len() > MAX_INGREDIENTS_COUNT {
        return Err(ValidationError::InvalidValue {
            field: "ingredients".to_string(),
            value: ingredients.len().to_string(),
            reason: format!(
                "Too many ingredients, maximum allowed: {}",
                MAX_INGREDIENTS_COUNT
            ),
        });
    }

    let mut seen_ingredients = HashSet::new();

    for (index, ingredient) in ingredients.iter().enumerate() {
        let trimmed = ingredient.trim();

        if trimmed.is_empty() {
            return Err(ValidationError::InvalidValue {
                field: format!("ingredients[{}]", index),
                value: ingredient.clone(),
                reason: "Ingredient cannot be empty".to_string(),
            });
        }

        if trimmed.len() > MAX_INGREDIENT_LENGTH {
            return Err(ValidationError::TooLong {
                field: format!("ingredients[{}]", index),
                max_length: MAX_INGREDIENT_LENGTH,
                actual_length: trimmed.len(),
            });
        }

        // Check for duplicates (case-insensitive)
        let ingredient_lower = trimmed.to_lowercase();
        if seen_ingredients.contains(&ingredient_lower) {
            return Err(ValidationError::InvalidValue {
                field: "ingredients".to_string(),
                value: ingredient.clone(),
                reason: "Duplicate ingredient found".to_string(),
            });
        }
        seen_ingredients.insert(ingredient_lower);
    }

    Ok(())
}

/// Validate feeding guidelines
pub fn validate_feeding_guidelines(guidelines: &Option<String>) -> ValidationResult<()> {
    if let Some(guidelines) = guidelines {
        let trimmed = guidelines.trim();

        if !trimmed.is_empty() && trimmed.len() > MAX_FEEDING_GUIDELINES_LENGTH {
            return Err(ValidationError::TooLong {
                field: "feeding_guidelines".to_string(),
                max_length: MAX_FEEDING_GUIDELINES_LENGTH,
                actual_length: trimmed.len(),
            });
        }
    }

    Ok(())
}

/// Validate stock quantity
pub fn validate_stock_quantity(quantity: u32) -> ValidationResult<()> {
    if quantity > MAX_STOCK_QUANTITY {
        return Err(ValidationError::OutOfRange {
            field: "stock_quantity".to_string(),
            min: "0".to_string(),
            max: MAX_STOCK_QUANTITY.to_string(),
            value: quantity.to_string(),
        });
    }

    Ok(())
}

/// Validate food ID format
pub fn validate_food_id(food_id: &str) -> ValidationResult<()> {
    let trimmed = food_id.trim();

    if trimmed.is_empty() {
        return Err(ValidationError::RequiredField {
            field: "food_id".to_string(),
        });
    }

    // Basic format validation - should start with 'F' followed by alphanumeric characters
    if !trimmed.starts_with('F') || trimmed.len() < 2 {
        return Err(ValidationError::InvalidFormat {
            field: "food_id".to_string(),
            expected: "Format: F followed by alphanumeric characters (e.g., F001, Fabc123)"
                .to_string(),
        });
    }

    // Check that characters after 'F' are alphanumeric
    if !trimmed[1..].chars().all(|c| c.is_alphanumeric()) {
        return Err(ValidationError::InvalidFormat {
            field: "food_id".to_string(),
            expected: "Food ID must contain only alphanumeric characters after 'F'".to_string(),
        });
    }

    Ok(())
}

/// Validate cart item quantity
pub fn validate_cart_quantity(quantity: u32) -> ValidationResult<()> {
    if quantity < MIN_CART_QUANTITY {
        return Err(ValidationError::OutOfRange {
            field: "quantity".to_string(),
            min: MIN_CART_QUANTITY.to_string(),
            max: MAX_CART_QUANTITY.to_string(),
            value: quantity.to_string(),
        });
    }

    if quantity > MAX_CART_QUANTITY {
        return Err(ValidationError::OutOfRange {
            field: "quantity".to_string(),
            min: MIN_CART_QUANTITY.to_string(),
            max: MAX_CART_QUANTITY.to_string(),
            value: quantity.to_string(),
        });
    }

    Ok(())
}

/// Validate user ID format
pub fn validate_user_id(user_id: &str) -> ValidationResult<()> {
    let trimmed = user_id.trim();

    if trimmed.is_empty() {
        return Err(ValidationError::RequiredField {
            field: "user_id".to_string(),
        });
    }

    // Basic validation - should be alphanumeric with possible hyphens and underscores
    if !trimmed
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ValidationError::InvalidFormat {
            field: "user_id".to_string(),
            expected: "User ID must contain only alphanumeric characters, hyphens, and underscores"
                .to_string(),
        });
    }

    if trimmed.len() > 100 {
        return Err(ValidationError::TooLong {
            field: "user_id".to_string(),
            max_length: 100,
            actual_length: trimmed.len(),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FoodType, PetType};
    use rust_decimal_macros::dec;

    #[test]
    fn test_validate_food_name() {
        // Valid names
        assert!(validate_food_name("Chicken Kibble").is_ok());
        assert!(validate_food_name("Premium Dog Food").is_ok());

        // Invalid names
        assert!(validate_food_name("").is_err());
        assert!(validate_food_name("   ").is_err());
        assert!(validate_food_name(&"a".repeat(MAX_FOOD_NAME_LENGTH + 1)).is_err());

        // Control characters
        assert!(validate_food_name("Test\x00Food").is_err());
    }

    #[test]
    fn test_validate_food_description() {
        // Valid descriptions
        assert!(validate_food_description("A nutritious blend of chicken and rice").is_ok());

        // Invalid descriptions
        assert!(validate_food_description("").is_err());
        assert!(validate_food_description("Short").is_err()); // Too short
        assert!(validate_food_description(&"a".repeat(MAX_DESCRIPTION_LENGTH + 1)).is_err());
    }

    #[test]
    fn test_validate_food_price() {
        // Valid prices
        assert!(validate_food_price(&dec!(12.99)).is_ok());
        assert!(validate_food_price(&dec!(0.01)).is_ok());
        assert!(validate_food_price(&dec!(999.99)).is_ok());

        // Invalid prices
        assert!(validate_food_price(&dec!(0.00)).is_err()); // Zero not allowed
        assert!(validate_food_price(&dec!(-1.00)).is_err()); // Negative
        assert!(validate_food_price(&dec!(10000.00)).is_err()); // Too high
    }

    #[test]
    fn test_validate_food_image() {
        // Valid images
        assert!(validate_food_image("food.jpg").is_ok());
        assert!(validate_food_image("image.png").is_ok());
        assert!(validate_food_image("photo.jpeg").is_ok());
        assert!(validate_food_image("pic.webp").is_ok());

        // Invalid images
        assert!(validate_food_image("").is_err());
        assert!(validate_food_image("file.txt").is_err()); // Wrong extension
        assert!(validate_food_image("noextension").is_err());
    }

    #[test]
    fn test_validate_ingredients() {
        // Valid ingredients
        assert!(validate_ingredients(&["chicken".to_string(), "rice".to_string()]).is_ok());

        // Invalid ingredients
        assert!(validate_ingredients(&[]).is_err()); // Empty
        assert!(validate_ingredients(&["".to_string()]).is_err()); // Empty ingredient
        assert!(validate_ingredients(&["chicken".to_string(), "chicken".to_string()]).is_err()); // Duplicate
        assert!(validate_ingredients(&["Chicken".to_string(), "chicken".to_string()]).is_err());
        // Case-insensitive duplicate
    }

    #[test]
    fn test_validate_food_id() {
        // Valid IDs
        assert!(validate_food_id("F001").is_ok());
        assert!(validate_food_id("Fabc123").is_ok());

        // Invalid IDs
        assert!(validate_food_id("").is_err());
        assert!(validate_food_id("001").is_err()); // Doesn't start with F
        assert!(validate_food_id("F").is_err()); // Too short
        assert!(validate_food_id("F-001").is_err()); // Invalid character
    }

    #[test]
    fn test_validate_cart_quantity() {
        // Valid quantities
        assert!(validate_cart_quantity(1).is_ok());
        assert!(validate_cart_quantity(50).is_ok());
        assert!(validate_cart_quantity(500).is_ok());
        assert!(validate_cart_quantity(MAX_CART_QUANTITY).is_ok());

        // Invalid quantities
        assert!(validate_cart_quantity(0).is_err()); // Too low
        assert!(validate_cart_quantity(MAX_CART_QUANTITY + 1).is_err()); // Too high
    }

    #[test]
    fn test_create_food_request_validation() {
        let valid_request = CreateFoodRequest {
            pet_type: PetType::Puppy,
            name: "Test Food".to_string(),
            food_type: FoodType::Dry,
            description: "A nutritious test food for puppies".to_string(),
            price: dec!(12.99),
            // No image field - will be generated via events
            nutritional_info: None,
            ingredients: vec!["chicken".to_string(), "rice".to_string()],
            feeding_guidelines: Some("Feed twice daily".to_string()),
            stock_quantity: 10,
        };

        assert!(valid_request.validate().is_ok());

        let invalid_request = CreateFoodRequest {
            name: "".to_string(), // Invalid empty name
            ..valid_request
        };

        assert!(invalid_request.validate().is_err());
    }

    #[test]
    fn test_add_cart_item_request_validation() {
        let valid_request = AddCartItemRequest {
            food_id: "F001".to_string(),
            quantity: 2,
        };

        assert!(valid_request.validate().is_ok());

        let invalid_request = AddCartItemRequest {
            food_id: "invalid".to_string(), // Invalid food ID
            quantity: 2,
        };

        assert!(invalid_request.validate().is_err());
    }
}
