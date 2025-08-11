use std::sync::Arc;
use tracing::{info, instrument};

use crate::models::{
    Food, PetType, FoodType, AvailabilityStatus, ServiceResult,
};
use crate::repositories::FoodRepository;

/// Service for providing food recommendations based on pet type
pub struct RecommendationService {
    food_repository: Arc<dyn FoodRepository>,
}

impl RecommendationService {
    /// Create a new RecommendationService
    pub fn new(food_repository: Arc<dyn FoodRepository>) -> Self {
        Self { food_repository }
    }

    /// Get food recommendations for a specific pet type
    #[instrument(skip(self), fields(pet_type = %pet_type))]
    pub async fn get_recommendations(&self, pet_type: PetType) -> ServiceResult<Vec<Food>> {
        info!("Getting recommendations for pet type");

        // Get all foods for the specified pet type
        let mut foods = self.food_repository.find_by_pet_type(pet_type.clone()).await?;

        // Filter to only include available foods
        foods.retain(|food| food.is_available());

        // Apply basic recommendation logic
        let recommendations = self.apply_recommendation_logic(foods, pet_type.clone());

        info!("Generated {} recommendations for pet type {}", recommendations.len(), pet_type);

        Ok(recommendations)
    }

    /// Get recommendations with additional filtering options
    #[instrument(skip(self), fields(pet_type = %pet_type, food_type = ?food_type, max_price = ?max_price))]
    pub async fn get_filtered_recommendations(
        &self,
        pet_type: PetType,
        food_type: Option<FoodType>,
        max_price: Option<rust_decimal::Decimal>,
        limit: Option<usize>,
    ) -> ServiceResult<Vec<Food>> {
        info!("Getting filtered recommendations");

        let mut recommendations = self.get_recommendations(pet_type).await?;

        // Apply food type filter
        if let Some(food_type) = food_type {
            recommendations.retain(|food| food.food_type == food_type);
        }

        // Apply price filter
        if let Some(max_price) = max_price {
            recommendations.retain(|food| food.food_price <= max_price);
        }

        // Apply limit
        if let Some(limit) = limit {
            recommendations.truncate(limit);
        }

        info!("Filtered recommendations count: {}", recommendations.len());

        Ok(recommendations)
    }

    /// Get top recommendations based on popularity/rating (simplified version)
    #[instrument(skip(self), fields(pet_type = %pet_type, limit = limit))]
    pub async fn get_top_recommendations(&self, pet_type: PetType, limit: usize) -> ServiceResult<Vec<Food>> {
        info!("Getting top recommendations");

        let mut recommendations = self.get_recommendations(pet_type).await?;

        // Sort by a simple scoring algorithm (price and stock availability)
        recommendations.sort_by(|a, b| {
            let score_a = self.calculate_recommendation_score(a);
            let score_b = self.calculate_recommendation_score(b);
            score_b.partial_cmp(&score_a).unwrap_or(std::cmp::Ordering::Equal)
        });

        // Limit the results
        recommendations.truncate(limit);

        info!("Top {} recommendations generated", recommendations.len());

        Ok(recommendations)
    }

    /// Get recommendations by food type for a pet
    #[instrument(skip(self), fields(pet_type = %pet_type, food_type = %food_type))]
    pub async fn get_recommendations_by_food_type(
        &self,
        pet_type: PetType,
        food_type: FoodType,
    ) -> ServiceResult<Vec<Food>> {
        info!("Getting recommendations by food type");

        let recommendations = self.get_filtered_recommendations(
            pet_type,
            Some(food_type),
            None,
            None,
        ).await?;

        Ok(recommendations)
    }

    /// Get budget-friendly recommendations
    #[instrument(skip(self), fields(pet_type = %pet_type, max_price = %max_price))]
    pub async fn get_budget_recommendations(
        &self,
        pet_type: PetType,
        max_price: rust_decimal::Decimal,
        limit: Option<usize>,
    ) -> ServiceResult<Vec<Food>> {
        info!("Getting budget-friendly recommendations");

        let mut recommendations = self.get_filtered_recommendations(
            pet_type,
            None,
            Some(max_price),
            limit,
        ).await?;

        // Sort by price (ascending) for budget recommendations
        recommendations.sort_by(|a, b| a.food_price.cmp(&b.food_price));

        info!("Budget recommendations count: {}", recommendations.len());

        Ok(recommendations)
    }

    /// Get premium recommendations (higher-priced, potentially better quality)
    #[instrument(skip(self), fields(pet_type = %pet_type, min_price = %min_price))]
    pub async fn get_premium_recommendations(
        &self,
        pet_type: PetType,
        min_price: rust_decimal::Decimal,
        limit: Option<usize>,
    ) -> ServiceResult<Vec<Food>> {
        info!("Getting premium recommendations");

        let mut recommendations = self.get_recommendations(pet_type).await?;

        // Filter for premium products (above minimum price)
        recommendations.retain(|food| food.food_price >= min_price);

        // Sort by price (descending) for premium recommendations
        recommendations.sort_by(|a, b| b.food_price.cmp(&a.food_price));

        // Apply limit
        if let Some(limit) = limit {
            recommendations.truncate(limit);
        }

        info!("Premium recommendations count: {}", recommendations.len());

        Ok(recommendations)
    }

    /// Check if recommendations are available for a pet type
    #[instrument(skip(self), fields(pet_type = %pet_type))]
    pub async fn has_recommendations(&self, pet_type: PetType) -> ServiceResult<bool> {
        info!("Checking if recommendations are available");

        let recommendations = self.get_recommendations(pet_type).await?;
        let has_recommendations = !recommendations.is_empty();

        info!("Has recommendations: {}", has_recommendations);

        Ok(has_recommendations)
    }

    /// Get recommendation statistics for a pet type
    #[instrument(skip(self), fields(pet_type = %pet_type))]
    pub async fn get_recommendation_stats(&self, pet_type: PetType) -> ServiceResult<RecommendationStats> {
        info!("Getting recommendation statistics");

        let recommendations = self.get_recommendations(pet_type).await?;

        let stats = RecommendationStats {
            total_count: recommendations.len(),
            dry_food_count: recommendations.iter().filter(|f| f.food_type == FoodType::Dry).count(),
            wet_food_count: recommendations.iter().filter(|f| f.food_type == FoodType::Wet).count(),
            treats_count: recommendations.iter().filter(|f| f.food_type == FoodType::Treats).count(),
            supplements_count: recommendations.iter().filter(|f| f.food_type == FoodType::Supplements).count(),
            average_price: if recommendations.is_empty() {
                rust_decimal::Decimal::ZERO
            } else {
                let total_price: rust_decimal::Decimal = recommendations.iter().map(|f| f.food_price).sum();
                total_price / rust_decimal::Decimal::from(recommendations.len())
            },
            price_range: if recommendations.is_empty() {
                None
            } else {
                let prices: Vec<_> = recommendations.iter().map(|f| f.food_price).collect();
                let min_price = *prices.iter().min().unwrap();
                let max_price = *prices.iter().max().unwrap();
                Some((min_price, max_price))
            },
        };

        info!("Recommendation stats: {} total, avg price: {}", stats.total_count, stats.average_price);

        Ok(stats)
    }

    /// Apply basic recommendation logic to filter and sort foods
    fn apply_recommendation_logic(&self, mut foods: Vec<Food>, pet_type: PetType) -> Vec<Food> {
        // Remove discontinued or out-of-stock items
        foods.retain(|food| {
            food.is_active 
                && food.availability_status == AvailabilityStatus::InStock 
                && food.stock_quantity > 0
        });

        // Apply pet-specific preferences
        match pet_type {
            PetType::Puppy => {
                // Prioritize dry food and treats for puppies
                foods.sort_by(|a, b| {
                    let score_a = match a.food_type {
                        FoodType::Dry => 3,
                        FoodType::Treats => 2,
                        FoodType::Wet => 1,
                        FoodType::Supplements => 0,
                    };
                    let score_b = match b.food_type {
                        FoodType::Dry => 3,
                        FoodType::Treats => 2,
                        FoodType::Wet => 1,
                        FoodType::Supplements => 0,
                    };
                    score_b.cmp(&score_a)
                });
            }
            PetType::Kitten => {
                // Prioritize wet food and treats for kittens
                foods.sort_by(|a, b| {
                    let score_a = match a.food_type {
                        FoodType::Wet => 3,
                        FoodType::Treats => 2,
                        FoodType::Dry => 1,
                        FoodType::Supplements => 0,
                    };
                    let score_b = match b.food_type {
                        FoodType::Wet => 3,
                        FoodType::Treats => 2,
                        FoodType::Dry => 1,
                        FoodType::Supplements => 0,
                    };
                    score_b.cmp(&score_a)
                });
            }
            PetType::Bunny => {
                // Prioritize dry food and supplements for bunnies
                foods.sort_by(|a, b| {
                    let score_a = match a.food_type {
                        FoodType::Dry => 3,
                        FoodType::Supplements => 2,
                        FoodType::Treats => 1,
                        FoodType::Wet => 0,
                    };
                    let score_b = match b.food_type {
                        FoodType::Dry => 3,
                        FoodType::Supplements => 2,
                        FoodType::Treats => 1,
                        FoodType::Wet => 0,
                    };
                    score_b.cmp(&score_a)
                });
            }
        }

        // Limit to reasonable number of recommendations
        foods.truncate(20);

        foods
    }

    /// Calculate a recommendation score for a food item
    fn calculate_recommendation_score(&self, food: &Food) -> f64 {
        let mut score = 0.0;

        // Base score from stock availability (more stock = higher score)
        score += (food.stock_quantity as f64).min(100.0) / 100.0 * 30.0;

        // Price factor (moderate prices get higher scores)
        let price_f64 = food.food_price.to_string().parse::<f64>().unwrap_or(0.0);
        if price_f64 > 0.0 {
            // Optimal price range is $5-$25, with peak at $15
            let price_score = if price_f64 <= 15.0 {
                price_f64 / 15.0 * 25.0
            } else {
                (30.0 - price_f64).max(0.0) / 15.0 * 25.0
            };
            score += price_score;
        }

        // Nutritional info bonus
        if food.nutritional_info.is_some() {
            score += 10.0;
        }

        // Feeding guidelines bonus
        if food.feeding_guidelines.is_some() {
            score += 5.0;
        }

        // Ingredient count bonus (more ingredients might indicate variety)
        score += (food.ingredients.len() as f64).min(10.0);

        score
    }
}

/// Statistics about recommendations for a pet type
#[derive(Debug, Clone)]
pub struct RecommendationStats {
    pub total_count: usize,
    pub dry_food_count: usize,
    pub wet_food_count: usize,
    pub treats_count: usize,
    pub supplements_count: usize,
    pub average_price: rust_decimal::Decimal,
    pub price_range: Option<(rust_decimal::Decimal, rust_decimal::Decimal)>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateFoodRequest, RepositoryError, ServiceError};
    use crate::repositories::FoodRepository;
    use async_trait::async_trait;
    use mockall::mock;
    use rust_decimal_macros::dec;

    // Mock repository for testing
    mock! {
        TestFoodRepository {}

        #[async_trait]
        impl FoodRepository for TestFoodRepository {
            async fn find_all(&self, filters: crate::models::FoodFilters) -> Result<Vec<Food>, RepositoryError>;
            async fn find_by_id(&self, food_id: &str) -> Result<Option<Food>, RepositoryError>;
            async fn find_by_pet_type(&self, pet_type: PetType) -> Result<Vec<Food>, RepositoryError>;
            async fn find_by_food_type(&self, food_type: FoodType) -> Result<Vec<Food>, RepositoryError>;
            async fn create(&self, food: Food) -> Result<Food, RepositoryError>;
            async fn update(&self, food: Food) -> Result<Food, RepositoryError>;
            async fn soft_delete(&self, food_id: &str) -> Result<(), RepositoryError>;
            async fn delete(&self, food_id: &str) -> Result<(), RepositoryError>;
            async fn exists(&self, food_id: &str) -> Result<bool, RepositoryError>;
            async fn count(&self, filters: Option<crate::models::FoodFilters>) -> Result<usize, RepositoryError>;
        }
    }

    fn create_test_foods() -> Vec<Food> {
        vec![
            create_test_food("F001", "Puppy Dry Food", FoodType::Dry, dec!(12.99), 10),
            create_test_food("F002", "Puppy Wet Food", FoodType::Wet, dec!(8.99), 5),
            create_test_food("F003", "Puppy Treats", FoodType::Treats, dec!(5.99), 20),
            create_test_food("F004", "Puppy Supplements", FoodType::Supplements, dec!(19.99), 8),
        ]
    }

    fn create_test_food(id: &str, name: &str, food_type: FoodType, price: rust_decimal::Decimal, stock: u32) -> Food {
        let request = CreateFoodRequest {
            food_for: PetType::Puppy,
            food_name: name.to_string(),
            food_type,
            food_description: format!("Test {} for puppies", name),
            food_price: price,
            food_image: format!("{}.jpg", id.to_lowercase()),
            nutritional_info: None,
            ingredients: vec!["chicken".to_string(), "rice".to_string()],
            feeding_guidelines: Some("Feed twice daily".to_string()),
            stock_quantity: stock,
        };
        let mut food = Food::new(request);
        food.food_id = id.to_string();
        food
    }

    #[tokio::test]
    async fn test_get_recommendations_success() {
        let mut mock_repo = MockTestFoodRepository::new();
        let test_foods = create_test_foods();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Puppy))
            .times(1)
            .returning(move |_| Ok(test_foods.clone()));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.get_recommendations(PetType::Puppy).await;

        assert!(result.is_ok());
        let recommendations = result.unwrap();
        assert_eq!(recommendations.len(), 4);

        // Check that dry food is prioritized for puppies
        assert_eq!(recommendations[0].food_type, FoodType::Dry);
    }

    #[tokio::test]
    async fn test_get_filtered_recommendations() {
        let mut mock_repo = MockTestFoodRepository::new();
        let test_foods = create_test_foods();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Puppy))
            .times(1)
            .returning(move |_| Ok(test_foods.clone()));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.get_filtered_recommendations(
            PetType::Puppy,
            Some(FoodType::Dry),
            Some(dec!(15.00)),
            Some(2),
        ).await;

        assert!(result.is_ok());
        let recommendations = result.unwrap();
        assert!(recommendations.len() <= 2);

        // All should be dry food and under $15
        for food in &recommendations {
            assert_eq!(food.food_type, FoodType::Dry);
            assert!(food.food_price <= dec!(15.00));
        }
    }

    #[tokio::test]
    async fn test_get_top_recommendations() {
        let mut mock_repo = MockTestFoodRepository::new();
        let test_foods = create_test_foods();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Puppy))
            .times(1)
            .returning(move |_| Ok(test_foods.clone()));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.get_top_recommendations(PetType::Puppy, 2).await;

        assert!(result.is_ok());
        let recommendations = result.unwrap();
        assert_eq!(recommendations.len(), 2);
    }

    #[tokio::test]
    async fn test_get_budget_recommendations() {
        let mut mock_repo = MockTestFoodRepository::new();
        let test_foods = create_test_foods();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Puppy))
            .times(1)
            .returning(move |_| Ok(test_foods.clone()));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.get_budget_recommendations(PetType::Puppy, dec!(10.00), None).await;

        assert!(result.is_ok());
        let recommendations = result.unwrap();

        // All should be under $10 and sorted by price
        for food in &recommendations {
            assert!(food.food_price <= dec!(10.00));
        }

        // Should be sorted by price (ascending)
        for i in 1..recommendations.len() {
            assert!(recommendations[i-1].food_price <= recommendations[i].food_price);
        }
    }

    #[tokio::test]
    async fn test_get_premium_recommendations() {
        let mut mock_repo = MockTestFoodRepository::new();
        let test_foods = create_test_foods();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Puppy))
            .times(1)
            .returning(move |_| Ok(test_foods.clone()));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.get_premium_recommendations(PetType::Puppy, dec!(15.00), None).await;

        assert!(result.is_ok());
        let recommendations = result.unwrap();

        // All should be over $15 and sorted by price (descending)
        for food in &recommendations {
            assert!(food.food_price >= dec!(15.00));
        }

        // Should be sorted by price (descending)
        for i in 1..recommendations.len() {
            assert!(recommendations[i-1].food_price >= recommendations[i].food_price);
        }
    }

    #[tokio::test]
    async fn test_has_recommendations() {
        let mut mock_repo = MockTestFoodRepository::new();
        let test_foods = create_test_foods();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Puppy))
            .times(1)
            .returning(move |_| Ok(test_foods.clone()));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.has_recommendations(PetType::Puppy).await;

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_has_no_recommendations() {
        let mut mock_repo = MockTestFoodRepository::new();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Bunny))
            .times(1)
            .returning(|_| Ok(vec![]));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.has_recommendations(PetType::Bunny).await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_get_recommendation_stats() {
        let mut mock_repo = MockTestFoodRepository::new();
        let test_foods = create_test_foods();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Puppy))
            .times(1)
            .returning(move |_| Ok(test_foods.clone()));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.get_recommendation_stats(PetType::Puppy).await;

        assert!(result.is_ok());
        let stats = result.unwrap();

        assert_eq!(stats.total_count, 4);
        assert_eq!(stats.dry_food_count, 1);
        assert_eq!(stats.wet_food_count, 1);
        assert_eq!(stats.treats_count, 1);
        assert_eq!(stats.supplements_count, 1);
        assert!(stats.average_price > rust_decimal::Decimal::ZERO);
        assert!(stats.price_range.is_some());

        let (min_price, max_price) = stats.price_range.unwrap();
        assert_eq!(min_price, dec!(5.99));
        assert_eq!(max_price, dec!(19.99));
    }

    #[tokio::test]
    async fn test_apply_recommendation_logic_puppy() {
        let service = RecommendationService::new(Arc::new(MockTestFoodRepository::new()));
        let foods = create_test_foods();

        let recommendations = service.apply_recommendation_logic(foods, PetType::Puppy);

        // Should prioritize dry food for puppies
        assert_eq!(recommendations[0].food_type, FoodType::Dry);
        assert_eq!(recommendations[1].food_type, FoodType::Treats);
    }

    #[tokio::test]
    async fn test_apply_recommendation_logic_kitten() {
        let service = RecommendationService::new(Arc::new(MockTestFoodRepository::new()));
        let mut foods = create_test_foods();
        
        // Change pet type to kitten for all foods
        for food in &mut foods {
            food.food_for = PetType::Kitten;
        }

        let recommendations = service.apply_recommendation_logic(foods, PetType::Kitten);

        // Should prioritize wet food for kittens
        assert_eq!(recommendations[0].food_type, FoodType::Wet);
        assert_eq!(recommendations[1].food_type, FoodType::Treats);
    }

    #[tokio::test]
    async fn test_calculate_recommendation_score() {
        let service = RecommendationService::new(Arc::new(MockTestFoodRepository::new()));
        let food = create_test_food("F001", "Test Food", FoodType::Dry, dec!(12.99), 10);

        let score = service.calculate_recommendation_score(&food);

        assert!(score > 0.0);
        // Score should include stock, price, nutritional info, feeding guidelines, and ingredients
    }

    #[tokio::test]
    async fn test_repository_error_propagation() {
        let mut mock_repo = MockTestFoodRepository::new();

        mock_repo
            .expect_find_by_pet_type()
            .with(mockall::predicate::eq(PetType::Puppy))
            .times(1)
            .returning(|_| Err(RepositoryError::ConnectionFailed));

        let service = RecommendationService::new(Arc::new(mock_repo));

        let result = service.get_recommendations(PetType::Puppy).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ServiceError::Repository { source } => {
                match source {
                    RepositoryError::ConnectionFailed => {}
                    _ => panic!("Expected ConnectionFailed error"),
                }
            }
            _ => panic!("Expected Repository error"),
        }
    }
}