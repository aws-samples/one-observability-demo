use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AvailabilityStatus, FoodType, PetType};

/// Core food product model
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Food {
    pub id: String,
    pub pet_type: PetType,
    pub name: String,
    pub food_type: FoodType,
    pub description: String,
    pub price: Decimal,
    pub image: Option<String>,
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
    pub pet_type: PetType,
    pub name: String,
    pub food_type: FoodType,
    pub description: String,
    pub price: Decimal,
    // Removed image field - will be generated via events using description as prompt
    pub nutritional_info: Option<NutritionalInfo>,
    pub ingredients: Vec<String>,
    pub feeding_guidelines: Option<String>,
    pub stock_quantity: u32,
}

/// Request model for updating an existing food product
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateFoodRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub price: Option<Decimal>,
    pub nutritional_info: Option<NutritionalInfo>,
    pub ingredients: Option<Vec<String>>,
    pub feeding_guidelines: Option<String>,
    pub availability_status: Option<AvailabilityStatus>,
    pub stock_quantity: Option<u32>,
}

/// Filters for querying food products
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
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

/// Response model for food listings with dynamically generated image URLs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoodListApiResponse {
    pub foods: Vec<FoodResponse>,
    pub total_count: usize,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

/// Response model for food with dynamically generated image URL
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoodResponse {
    pub id: String,
    pub pet_type: PetType,
    pub name: String,
    pub food_type: FoodType,
    pub description: String,
    pub price: Decimal,
    pub image: String, // This will contain the full CDN URL
    pub nutritional_info: Option<NutritionalInfo>,
    pub ingredients: Vec<String>,
    pub feeding_guidelines: Option<String>,
    pub availability_status: AvailabilityStatus,
    pub stock_quantity: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_active: bool,
}

impl Food {
    /// Create a new Food instance with generated ID and timestamps
    /// Image will be None initially and generated via events using description as prompt
    pub fn new(request: CreateFoodRequest) -> Self {
        let now = Utc::now();
        Self {
            id: format!(
                "F{}",
                Uuid::new_v4()
                    .simple()
                    .to_string()
                    .get(0..8)
                    .unwrap_or("00000000")
            ),
            pet_type: request.pet_type,
            name: request.name,
            food_type: request.food_type,
            description: request.description,
            price: request.price,
            image: None, // Will be set later via image generation events
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

    /// Check if the food needs image generation
    pub fn needs_image_generation(&self) -> bool {
        self.image.is_none()
    }

    /// Update the food with new values from UpdateFoodRequest
    pub fn update(&mut self, request: UpdateFoodRequest) {
        if let Some(name) = request.name {
            self.name = name;
        }
        if let Some(description) = request.description {
            self.description = description;
        }
        if let Some(price) = request.price {
            self.price = price;
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
            if &self.pet_type != pet_type {
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
            if &self.price < min_price {
                return false;
            }
        }

        if let Some(max_price) = &filters.max_price {
            if &self.price > max_price {
                return false;
            }
        }

        if let Some(search_term) = &filters.search_term {
            let search_lower = search_term.to_lowercase();
            if !self.name.to_lowercase().contains(&search_lower)
                && !self.description.to_lowercase().contains(&search_lower)
                && !self
                    .ingredients
                    .iter()
                    .any(|ingredient| ingredient.to_lowercase().contains(&search_lower))
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

    /// Convert Food to FoodResponse with full image URL
    /// Returns a placeholder or generates CDN URL if image exists
    pub fn to_response(&self, assets_cdn_url: &str) -> FoodResponse {
        let image_url = match &self.image {
            Some(image_path) => {
                if assets_cdn_url.is_empty() {
                    image_path.clone()
                } else {
                    // Handle trailing slash in CDN URL to avoid double slashes
                    let cdn_url = if assets_cdn_url.ends_with('/') {
                        assets_cdn_url.trim_end_matches('/')
                    } else {
                        assets_cdn_url
                    };
                    format!("{}/{}", cdn_url, image_path)
                }
            }
            None => {
                // Return an empty image URL when no image is available
                "".to_string()
            }
        };

        FoodResponse {
            id: self.id.clone(),
            pet_type: self.pet_type.clone(),
            name: self.name.clone(),
            food_type: self.food_type.clone(),
            description: self.description.clone(),
            price: self.price,
            image: image_url,
            nutritional_info: self.nutritional_info.clone(),
            ingredients: self.ingredients.clone(),
            feeding_guidelines: self.feeding_guidelines.clone(),
            availability_status: self.availability_status.clone(),
            stock_quantity: self.stock_quantity,
            created_at: self.created_at,
            updated_at: self.updated_at,
            is_active: self.is_active,
        }
    }

    /// Set the image path after it has been generated
    /// This should be called when the image generation process completes
    pub fn set_image(&mut self, image_path: String) {
        self.image = Some(image_path);
        self.updated_at = Utc::now();
    }
}

impl FoodResponse {
    /// Check if the food is available for purchase
    pub fn is_available(&self) -> bool {
        self.is_active
            && self.availability_status == AvailabilityStatus::InStock
            && self.stock_quantity > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn create_test_food_request() -> CreateFoodRequest {
        CreateFoodRequest {
            pet_type: PetType::Puppy,
            name: "Test Kibble".to_string(),
            food_type: FoodType::Dry,
            description: "Nutritious test food".to_string(),
            price: dec!(12.99),
            // No image field - will be generated via events
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

        assert!(food.id.starts_with('F'));
        assert_eq!(food.pet_type, PetType::Puppy);
        assert_eq!(food.name, "Test Kibble");
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
            name: Some("Updated Kibble".to_string()),
            price: Some(dec!(15.99)),
            stock_quantity: Some(0),
            ..Default::default()
        };

        food.update(update_request);

        assert_eq!(food.name, "Updated Kibble");
        assert_eq!(food.price, dec!(15.99));
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

    #[test]
    fn test_image_url_generation() {
        // Create a food without image (new behavior)
        let request = create_test_food_request();
        let mut food = Food::new(request);

        // Initially, food should have no image and need generation
        assert_eq!(food.image, None);
        assert!(food.needs_image_generation());

        // Test empty image URLs when no image is set
        let s3_cdn_url = "https://petfood-assets.s3.amazonaws.com";
        let cloudfront_cdn_url = "https://d1234567890.cloudfront.net/images";
        let empty_cdn_url = "";

        let s3_response = food.to_response(s3_cdn_url);
        let cloudfront_response = food.to_response(cloudfront_cdn_url);
        let empty_cdn_response = food.to_response(empty_cdn_url);

        // Verify empty strings are returned when no image exists
        assert_eq!(s3_response.image, "");
        assert_eq!(cloudfront_response.image, "");
        assert_eq!(empty_cdn_response.image, "");

        // Now set an image and test URL generation
        food.set_image("petfood/test-kibble.jpg".to_string());
        assert_eq!(food.image, Some("petfood/test-kibble.jpg".to_string()));
        assert!(!food.needs_image_generation());

        // Test conversion to response with actual image
        let s3_response_with_image = food.to_response(s3_cdn_url);
        let cloudfront_response_with_image = food.to_response(cloudfront_cdn_url);
        let empty_cdn_response_with_image = food.to_response(empty_cdn_url);

        // Verify the URLs are correctly generated with actual image
        assert_eq!(
            s3_response_with_image.image,
            "https://petfood-assets.s3.amazonaws.com/petfood/test-kibble.jpg"
        );
        assert_eq!(
            cloudfront_response_with_image.image,
            "https://d1234567890.cloudfront.net/images/petfood/test-kibble.jpg"
        );
        assert_eq!(
            empty_cdn_response_with_image.image,
            "petfood/test-kibble.jpg"
        );

        // Verify other fields are preserved
        assert_eq!(s3_response_with_image.name, food.name);
        assert_eq!(s3_response_with_image.price, food.price);
        assert_eq!(s3_response_with_image.pet_type, food.pet_type);
    }

    #[test]
    fn test_image_generation_workflow() {
        let request = create_test_food_request();
        let mut food = Food::new(request);

        // Initially needs image generation
        assert!(food.needs_image_generation());
        assert_eq!(food.image, None);

        // Simulate image generation completion
        food.set_image("petfood/generated-image.jpg".to_string());

        // Should no longer need image generation
        assert!(!food.needs_image_generation());
        assert_eq!(food.image, Some("petfood/generated-image.jpg".to_string()));
    }
}
