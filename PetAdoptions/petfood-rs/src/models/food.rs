use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AvailabilityStatus, FoodType, PetType};

/// Core food product model
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Food {
    pub food_id: String,
    pub food_for: PetType,
    pub food_name: String,
    pub food_type: FoodType,
    pub food_description: String,
    pub food_price: Decimal,
    pub food_image: String,
    pub nutritional_info: Option<NutritionalInfo>,
    pub ingredients: Vec<String>,
    pub feeding_guidelines: Option<String>,
    pub availability_status: AvailabilityStatus,
    pub stock_quantity: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_active: bool,
}

/// Nutritional information for food products
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NutritionalInfo {
    pub calories_per_serving: Option<u32>,
    pub protein_percentage: Option<Decimal>,
    pub fat_percentage: Option<Decimal>,
    pub carbohydrate_percentage: Option<Decimal>,
    pub fiber_percentage: Option<Decimal>,
    pub moisture_percentage: Option<Decimal>,
    pub serving_size: Option<String>,
    pub servings_per_container: Option<u32>,
}

/// Request model for creating a new food product
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFoodRequest {
    pub food_for: PetType,
    pub food_name: String,
    pub food_type: FoodType,
    pub food_description: String,
    pub food_price: Decimal,
    pub food_image: String,
    pub nutritional_info: Option<NutritionalInfo>,
    pub ingredients: Vec<String>,
    pub feeding_guidelines: Option<String>,
    pub stock_quantity: u32,
}

/// Request model for updating an existing food product
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFoodRequest {
    pub food_name: Option<String>,
    pub food_description: Option<String>,
    pub food_price: Option<Decimal>,
    pub food_image: Option<String>,
    pub nutritional_info: Option<NutritionalInfo>,
    pub ingredients: Option<Vec<String>>,
    pub feeding_guidelines: Option<String>,
    pub availability_status: Option<AvailabilityStatus>,
    pub stock_quantity: Option<u32>,
}

/// Filters for querying food products
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FoodFilters {
    pub pet_type: Option<PetType>,
    pub food_type: Option<FoodType>,
    pub availability_status: Option<AvailabilityStatus>,
    pub min_price: Option<Decimal>,
    pub max_price: Option<Decimal>,
    pub search_term: Option<String>,
    pub in_stock_only: Option<bool>,
}

/// Response model for food listings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoodListResponse {
    pub foods: Vec<Food>,
    pub total_count: usize,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

impl Food {
    /// Create a new Food instance with generated ID and timestamps
    pub fn new(request: CreateFoodRequest) -> Self {
        let now = Utc::now();
        Self {
            food_id: format!("F{}", Uuid::new_v4().simple().to_string().get(0..8).unwrap_or("00000000")),
            food_for: request.food_for,
            food_name: request.food_name,
            food_type: request.food_type,
            food_description: request.food_description,
            food_price: request.food_price,
            food_image: request.food_image,
            nutritional_info: request.nutritional_info,
            ingredients: request.ingredients,
            feeding_guidelines: request.feeding_guidelines,
            availability_status: if request.stock_quantity > 0 {
                AvailabilityStatus::InStock
            } else {
                AvailabilityStatus::OutOfStock
            },
            stock_quantity: request.stock_quantity,
            created_at: now,
            updated_at: now,
            is_active: true,
        }
    }

    /// Update the food with new values from UpdateFoodRequest
    pub fn update(&mut self, request: UpdateFoodRequest) {
        if let Some(name) = request.food_name {
            self.food_name = name;
        }
        if let Some(description) = request.food_description {
            self.food_description = description;
        }
        if let Some(price) = request.food_price {
            self.food_price = price;
        }
        if let Some(image) = request.food_image {
            self.food_image = image;
        }
        if let Some(nutritional_info) = request.nutritional_info {
            self.nutritional_info = Some(nutritional_info);
        }
        if let Some(ingredients) = request.ingredients {
            self.ingredients = ingredients;
        }
        if let Some(guidelines) = request.feeding_guidelines {
            self.feeding_guidelines = Some(guidelines);
        }
        if let Some(status) = request.availability_status {
            self.availability_status = status;
        }
        if let Some(stock) = request.stock_quantity {
            self.stock_quantity = stock;
            // Auto-update availability based on stock
            if stock == 0 && self.availability_status == AvailabilityStatus::InStock {
                self.availability_status = AvailabilityStatus::OutOfStock;
            } else if stock > 0 && self.availability_status == AvailabilityStatus::OutOfStock {
                self.availability_status = AvailabilityStatus::InStock;
            }
        }
        self.updated_at = Utc::now();
    }

    /// Soft delete the food product
    pub fn soft_delete(&mut self) {
        self.is_active = false;
        self.availability_status = AvailabilityStatus::Discontinued;
        self.updated_at = Utc::now();
    }

    /// Check if the food is available for purchase
    pub fn is_available(&self) -> bool {
        self.is_active 
            && self.availability_status == AvailabilityStatus::InStock 
            && self.stock_quantity > 0
    }

    /// Check if the food matches the given filters
    pub fn matches_filters(&self, filters: &FoodFilters) -> bool {
        if let Some(pet_type) = &filters.pet_type {
            if &self.food_for != pet_type {
                return false;
            }
        }

        if let Some(food_type) = &filters.food_type {
            if &self.food_type != food_type {
                return false;
            }
        }

        if let Some(status) = &filters.availability_status {
            if &self.availability_status != status {
                return false;
            }
        }

        if let Some(min_price) = &filters.min_price {
            if &self.food_price < min_price {
                return false;
            }
        }

        if let Some(max_price) = &filters.max_price {
            if &self.food_price > max_price {
                return false;
            }
        }

        if let Some(search_term) = &filters.search_term {
            let search_lower = search_term.to_lowercase();
            if !self.food_name.to_lowercase().contains(&search_lower)
                && !self.food_description.to_lowercase().contains(&search_lower)
                && !self.ingredients.iter().any(|ingredient| 
                    ingredient.to_lowercase().contains(&search_lower))
            {
                return false;
            }
        }

        if let Some(true) = filters.in_stock_only {
            if !self.is_available() {
                return false;
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn create_test_food_request() -> CreateFoodRequest {
        CreateFoodRequest {
            food_for: PetType::Puppy,
            food_name: "Test Kibble".to_string(),
            food_type: FoodType::Dry,
            food_description: "Nutritious test food".to_string(),
            food_price: dec!(12.99),
            food_image: "test.jpg".to_string(),
            nutritional_info: None,
            ingredients: vec!["chicken".to_string(), "rice".to_string()],
            feeding_guidelines: Some("Feed twice daily".to_string()),
            stock_quantity: 10,
        }
    }

    #[test]
    fn test_food_creation() {
        let request = create_test_food_request();
        let food = Food::new(request);

        assert!(food.food_id.starts_with('F'));
        assert_eq!(food.food_for, PetType::Puppy);
        assert_eq!(food.food_name, "Test Kibble");
        assert_eq!(food.availability_status, AvailabilityStatus::InStock);
        assert!(food.is_active);
        assert!(food.is_available());
    }

    #[test]
    fn test_food_update() {
        let request = create_test_food_request();
        let mut food = Food::new(request);
        let original_updated_at = food.updated_at;

        // Small delay to ensure timestamp changes
        std::thread::sleep(std::time::Duration::from_millis(1));

        let update_request = UpdateFoodRequest {
            food_name: Some("Updated Kibble".to_string()),
            food_price: Some(dec!(15.99)),
            stock_quantity: Some(0),
            ..Default::default()
        };

        food.update(update_request);

        assert_eq!(food.food_name, "Updated Kibble");
        assert_eq!(food.food_price, dec!(15.99));
        assert_eq!(food.stock_quantity, 0);
        assert_eq!(food.availability_status, AvailabilityStatus::OutOfStock);
        assert!(food.updated_at > original_updated_at);
        assert!(!food.is_available());
    }

    #[test]
    fn test_food_soft_delete() {
        let request = create_test_food_request();
        let mut food = Food::new(request);

        food.soft_delete();

        assert!(!food.is_active);
        assert_eq!(food.availability_status, AvailabilityStatus::Discontinued);
        assert!(!food.is_available());
    }

    #[test]
    fn test_food_filters() {
        let request = create_test_food_request();
        let food = Food::new(request);

        let filters = FoodFilters {
            pet_type: Some(PetType::Puppy),
            search_term: Some("kibble".to_string()),
            in_stock_only: Some(true),
            ..Default::default()
        };

        assert!(food.matches_filters(&filters));

        let filters = FoodFilters {
            pet_type: Some(PetType::Kitten),
            ..Default::default()
        };

        assert!(!food.matches_filters(&filters));
    }

    #[test]
    fn test_serde_serialization() {
        let request = create_test_food_request();
        let food = Food::new(request);

        let json = serde_json::to_string(&food).unwrap();
        let deserialized: Food = serde_json::from_str(&json).unwrap();

        assert_eq!(food, deserialized);
    }
}

impl Default for UpdateFoodRequest {
    fn default() -> Self {
        Self {
            food_name: None,
            food_description: None,
            food_price: None,
            food_image: None,
            nutritional_info: None,
            ingredients: None,
            feeding_guidelines: None,
            availability_status: None,
            stock_quantity: None,
        }
    }
}