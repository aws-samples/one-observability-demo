use std::sync::Arc;
use tracing::{info, instrument, warn};

use crate::models::{
    Cart, CartItem, CartResponse, CartItemResponse, AddCartItemRequest, UpdateCartItemRequest,
    ServiceError, ServiceResult,
};
use crate::repositories::{CartRepository, FoodRepository};

/// Service for managing shopping carts
pub struct CartService {
    cart_repository: Arc<dyn CartRepository>,
    food_repository: Arc<dyn FoodRepository>,
}

impl CartService {
    /// Create a new CartService
    pub fn new(
        cart_repository: Arc<dyn CartRepository>,
        food_repository: Arc<dyn FoodRepository>,
    ) -> Self {
        Self {
            cart_repository,
            food_repository,
        }
    }

    /// Get a user's cart
    #[instrument(skip(self), fields(user_id = %user_id))]
    pub async fn get_cart(&self, user_id: &str) -> ServiceResult<CartResponse> {
        info!("Getting cart for user");

        // Validate user_id
        if user_id.trim().is_empty() {
            return Err(ServiceError::ValidationError {
                message: "User ID cannot be empty".to_string(),
            });
        }

        let cart = match self.cart_repository.find_cart(user_id).await? {
            Some(cart) => cart,
            None => {
                info!("Cart not found, creating empty cart");
                Cart::new(user_id.to_string())
            }
        };

        // Convert to response with food details
        let cart_response = self.cart_to_response(cart).await?;

        info!("Cart retrieved with {} items", cart_response.items.len());
        Ok(cart_response)
    }

    /// Add an item to the cart
    #[instrument(skip(self, request), fields(user_id = %user_id, food_id = %request.food_id, quantity = request.quantity))]
    pub async fn add_item(&self, user_id: &str, request: AddCartItemRequest) -> ServiceResult<CartItemResponse> {
        info!("Adding item to cart");

        // Validate inputs
        self.validate_user_id(user_id)?;
        self.validate_add_cart_item_request(&request)?;

        // Check if food exists and is available
        let food = match self.food_repository.find_by_id(&request.food_id).await? {
            Some(food) => food,
            None => {
                return Err(ServiceError::FoodNotFound {
                    food_id: request.food_id,
                });
            }
        };

        // Check availability and stock
        if !food.is_available() {
            return Err(ServiceError::ProductUnavailable {
                food_id: food.food_id.clone(),
            });
        }

        if food.stock_quantity < request.quantity {
            return Err(ServiceError::InsufficientStock {
                requested: request.quantity,
                available: food.stock_quantity,
            });
        }

        // Get or create cart
        let mut cart = match self.cart_repository.find_cart(user_id).await? {
            Some(cart) => cart,
            None => Cart::new(user_id.to_string()),
        };

        // Add item to cart
        cart.add_item(request.food_id.clone(), request.quantity, food.food_price);

        // Save cart
        let updated_cart = self.cart_repository.save_cart(cart).await?;

        // Find the added item and convert to response
        let cart_item = updated_cart
            .get_item(&request.food_id)
            .ok_or_else(|| ServiceError::CartItemNotFound {
                food_id: request.food_id.clone(),
                user_id: user_id.to_string(),
            })?;

        let item_response = self.cart_item_to_response(cart_item, &food).await?;

        info!("Item added to cart successfully");
        Ok(item_response)
    }

    /// Update the quantity of an item in the cart
    #[instrument(skip(self, request), fields(user_id = %user_id, food_id = %food_id, quantity = request.quantity))]
    pub async fn update_item(
        &self,
        user_id: &str,
        food_id: &str,
        request: UpdateCartItemRequest,
    ) -> ServiceResult<CartItemResponse> {
        info!("Updating cart item quantity");

        // Validate inputs
        self.validate_user_id(user_id)?;
        self.validate_food_id(food_id)?;
        self.validate_quantity(request.quantity)?;

        // Get cart
        let mut cart = match self.cart_repository.find_cart(user_id).await? {
            Some(cart) => cart,
            None => {
                return Err(ServiceError::CartNotFound {
                    user_id: user_id.to_string(),
                });
            }
        };

        // Check if item exists in cart
        if !cart.contains_item(food_id) {
            return Err(ServiceError::CartItemNotFound {
                food_id: food_id.to_string(),
                user_id: user_id.to_string(),
            });
        }

        // Get food details for validation
        let food = match self.food_repository.find_by_id(food_id).await? {
            Some(food) => food,
            None => {
                return Err(ServiceError::FoodNotFound {
                    food_id: food_id.to_string(),
                });
            }
        };

        // Check stock availability for new quantity
        if request.quantity > 0 && food.stock_quantity < request.quantity {
            return Err(ServiceError::InsufficientStock {
                requested: request.quantity,
                available: food.stock_quantity,
            });
        }

        // Update item quantity
        cart.update_item_quantity(food_id, request.quantity);

        // Save cart
        let updated_cart = self.cart_repository.save_cart(cart).await?;

        // If quantity was set to 0, the item was removed
        if request.quantity == 0 {
            info!("Item removed from cart (quantity set to 0)");
            return Err(ServiceError::CartItemNotFound {
                food_id: food_id.to_string(),
                user_id: user_id.to_string(),
            });
        }

        // Get updated item and convert to response
        let cart_item = updated_cart
            .get_item(food_id)
            .ok_or_else(|| ServiceError::CartItemNotFound {
                food_id: food_id.to_string(),
                user_id: user_id.to_string(),
            })?;

        let item_response = self.cart_item_to_response(cart_item, &food).await?;

        info!("Cart item updated successfully");
        Ok(item_response)
    }

    /// Remove an item from the cart
    #[instrument(skip(self), fields(user_id = %user_id, food_id = %food_id))]
    pub async fn remove_item(&self, user_id: &str, food_id: &str) -> ServiceResult<()> {
        info!("Removing item from cart");

        // Validate inputs
        self.validate_user_id(user_id)?;
        self.validate_food_id(food_id)?;

        // Get cart
        let mut cart = match self.cart_repository.find_cart(user_id).await? {
            Some(cart) => cart,
            None => {
                return Err(ServiceError::CartNotFound {
                    user_id: user_id.to_string(),
                });
            }
        };

        // Check if item exists in cart
        if !cart.contains_item(food_id) {
            return Err(ServiceError::CartItemNotFound {
                food_id: food_id.to_string(),
                user_id: user_id.to_string(),
            });
        }

        // Remove item
        cart.remove_item(food_id);

        // Save cart
        self.cart_repository.save_cart(cart).await?;

        info!("Item removed from cart successfully");
        Ok(())
    }

    /// Clear all items from the cart
    #[instrument(skip(self), fields(user_id = %user_id))]
    pub async fn clear_cart(&self, user_id: &str) -> ServiceResult<()> {
        info!("Clearing cart");

        // Validate user_id
        self.validate_user_id(user_id)?;

        // Get cart
        let mut cart = match self.cart_repository.find_cart(user_id).await? {
            Some(cart) => cart,
            None => {
                // Cart doesn't exist, nothing to clear
                info!("Cart not found, nothing to clear");
                return Ok(());
            }
        };

        // Clear all items
        cart.clear();

        // Save empty cart
        self.cart_repository.save_cart(cart).await?;

        info!("Cart cleared successfully");
        Ok(())
    }

    /// Delete the entire cart
    #[instrument(skip(self), fields(user_id = %user_id))]
    pub async fn delete_cart(&self, user_id: &str) -> ServiceResult<()> {
        info!("Deleting cart");

        // Validate user_id
        self.validate_user_id(user_id)?;

        // Check if cart exists
        if !self.cart_repository.cart_exists(user_id).await? {
            return Err(ServiceError::CartNotFound {
                user_id: user_id.to_string(),
            });
        }

        // Delete cart
        self.cart_repository.delete_cart(user_id).await?;

        info!("Cart deleted successfully");
        Ok(())
    }

    /// Get the total number of items in a user's cart
    #[instrument(skip(self), fields(user_id = %user_id))]
    pub async fn get_cart_item_count(&self, user_id: &str) -> ServiceResult<u32> {
        info!("Getting cart item count");

        let cart_response = self.get_cart(user_id).await?;
        let count = cart_response.total_items;

        info!("Cart item count: {}", count);
        Ok(count)
    }

    /// Get the total price of items in a user's cart
    #[instrument(skip(self), fields(user_id = %user_id))]
    pub async fn get_cart_total(&self, user_id: &str) -> ServiceResult<rust_decimal::Decimal> {
        info!("Getting cart total");

        let cart_response = self.get_cart(user_id).await?;
        let total = cart_response.total_price;

        info!("Cart total: {}", total);
        Ok(total)
    }

    /// Check if a user has any items in their cart
    #[instrument(skip(self), fields(user_id = %user_id))]
    pub async fn is_cart_empty(&self, user_id: &str) -> ServiceResult<bool> {
        info!("Checking if cart is empty");

        let cart = match self.cart_repository.find_cart(user_id).await? {
            Some(cart) => cart,
            None => return Ok(true),
        };

        let is_empty = cart.is_empty();
        info!("Cart is empty: {}", is_empty);
        Ok(is_empty)
    }

    /// Validate cart contents (check availability and stock)
    #[instrument(skip(self), fields(user_id = %user_id))]
    pub async fn validate_cart(&self, user_id: &str) -> ServiceResult<Vec<String>> {
        info!("Validating cart contents");

        let cart = match self.cart_repository.find_cart(user_id).await? {
            Some(cart) => cart,
            None => return Ok(vec![]),
        };

        let mut issues = Vec::new();

        for item in &cart.items {
            match self.food_repository.find_by_id(&item.food_id).await? {
                Some(food) => {
                    if !food.is_available() {
                        issues.push(format!("Product {} is no longer available", food.food_name));
                    } else if food.stock_quantity < item.quantity {
                        issues.push(format!(
                            "Insufficient stock for {}: requested {}, available {}",
                            food.food_name, item.quantity, food.stock_quantity
                        ));
                    }
                }
                None => {
                    issues.push(format!("Product with ID {} no longer exists", item.food_id));
                }
            }
        }

        info!("Cart validation found {} issues", issues.len());
        Ok(issues)
    }

    /// Convert Cart to CartResponse with food details
    async fn cart_to_response(&self, cart: Cart) -> ServiceResult<CartResponse> {
        let mut items = Vec::new();

        for cart_item in &cart.items {
            match self.food_repository.find_by_id(&cart_item.food_id).await? {
                Some(food) => {
                    let item_response = self.cart_item_to_response(cart_item, &food).await?;
                    items.push(item_response);
                }
                None => {
                    warn!("Food not found for cart item: {}", cart_item.food_id);
                    // Create a placeholder response for missing food
                    let item_response = CartItemResponse {
                        food_id: cart_item.food_id.clone(),
                        food_name: "Product not found".to_string(),
                        food_image: "placeholder.jpg".to_string(),
                        quantity: cart_item.quantity,
                        unit_price: cart_item.unit_price,
                        total_price: cart_item.total_price(),
                        is_available: false,
                        added_at: cart_item.added_at,
                    };
                    items.push(item_response);
                }
            }
        }

        let total_items = cart.total_items();
        let total_price = cart.total_price();
        let created_at = cart.created_at;
        let updated_at = cart.updated_at;
        let user_id = cart.user_id;

        Ok(CartResponse {
            user_id,
            items,
            total_items,
            total_price,
            created_at,
            updated_at,
        })
    }

    /// Convert CartItem to CartItemResponse with food details
    async fn cart_item_to_response(
        &self,
        cart_item: &CartItem,
        food: &crate::models::Food,
    ) -> ServiceResult<CartItemResponse> {
        Ok(CartItemResponse {
            food_id: cart_item.food_id.clone(),
            food_name: food.food_name.clone(),
            food_image: food.food_image.clone(),
            quantity: cart_item.quantity,
            unit_price: cart_item.unit_price,
            total_price: cart_item.total_price(),
            is_available: food.is_available(),
            added_at: cart_item.added_at,
        })
    }

    /// Validate user ID
    fn validate_user_id(&self, user_id: &str) -> ServiceResult<()> {
        if user_id.trim().is_empty() {
            return Err(ServiceError::ValidationError {
                message: "User ID cannot be empty".to_string(),
            });
        }
        Ok(())
    }

    /// Validate food ID
    fn validate_food_id(&self, food_id: &str) -> ServiceResult<()> {
        if food_id.trim().is_empty() {
            return Err(ServiceError::ValidationError {
                message: "Food ID cannot be empty".to_string(),
            });
        }
        Ok(())
    }

    /// Validate quantity
    fn validate_quantity(&self, quantity: u32) -> ServiceResult<()> {
        if quantity == 0 {
            return Err(ServiceError::InvalidQuantity { quantity });
        }
        if quantity > 100 {
            return Err(ServiceError::ValidationError {
                message: "Quantity cannot exceed 100".to_string(),
            });
        }
        Ok(())
    }

    /// Validate add cart item request
    fn validate_add_cart_item_request(&self, request: &AddCartItemRequest) -> ServiceResult<()> {
        self.validate_food_id(&request.food_id)?;
        self.validate_quantity(request.quantity)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateFoodRequest, Food, PetType, FoodType, RepositoryError};
    use crate::repositories::{CartRepository, FoodRepository};
    use async_trait::async_trait;
    use mockall::mock;
    use rust_decimal_macros::dec;

    // Mock repositories for testing
    mock! {
        TestCartRepository {}

        #[async_trait]
        impl CartRepository for TestCartRepository {
            async fn find_cart(&self, user_id: &str) -> Result<Option<Cart>, RepositoryError>;
            async fn save_cart(&self, cart: Cart) -> Result<Cart, RepositoryError>;
            async fn delete_cart(&self, user_id: &str) -> Result<(), RepositoryError>;
            async fn cart_exists(&self, user_id: &str) -> Result<bool, RepositoryError>;
            async fn find_all_carts(&self) -> Result<Vec<Cart>, RepositoryError>;
            async fn count_carts(&self) -> Result<usize, RepositoryError>;
        }
    }

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

    fn create_test_food() -> Food {
        let request = CreateFoodRequest {
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
        };
        let mut food = Food::new(request);
        food.food_id = "F001".to_string();
        food
    }

    fn create_test_cart() -> Cart {
        let mut cart = Cart::new("user123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        cart
    }

    #[tokio::test]
    async fn test_get_cart_existing() {
        let mut mock_cart_repo = MockTestCartRepository::new();
        let mut mock_food_repo = MockTestFoodRepository::new();
        let test_cart = create_test_cart();
        let test_food = create_test_food();

        mock_cart_repo
            .expect_find_cart()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_cart.clone())));

        mock_food_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq("F001".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_food.clone())));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let result = service.get_cart("user123").await;

        assert!(result.is_ok());
        let cart_response = result.unwrap();
        assert_eq!(cart_response.user_id, "user123");
        assert_eq!(cart_response.items.len(), 1);
        assert_eq!(cart_response.total_items, 2);
    }

    #[tokio::test]
    async fn test_get_cart_not_found() {
        let mut mock_cart_repo = MockTestCartRepository::new();
        let mock_food_repo = MockTestFoodRepository::new();

        mock_cart_repo
            .expect_find_cart()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(|_| Ok(None));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let result = service.get_cart("user123").await;

        assert!(result.is_ok());
        let cart_response = result.unwrap();
        assert_eq!(cart_response.user_id, "user123");
        assert_eq!(cart_response.items.len(), 0);
        assert_eq!(cart_response.total_items, 0);
    }

    #[tokio::test]
    async fn test_add_item_success() {
        let mut mock_cart_repo = MockTestCartRepository::new();
        let mut mock_food_repo = MockTestFoodRepository::new();
        let test_food = create_test_food();

        mock_cart_repo
            .expect_find_cart()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(|_| Ok(None));

        mock_cart_repo
            .expect_save_cart()
            .times(1)
            .returning(|cart| Ok(cart));

        mock_food_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq("F001".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_food.clone())));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let request = AddCartItemRequest {
            food_id: "F001".to_string(),
            quantity: 2,
        };

        let result = service.add_item("user123", request).await;

        assert!(result.is_ok());
        let item_response = result.unwrap();
        assert_eq!(item_response.food_id, "F001");
        assert_eq!(item_response.quantity, 2);
        assert!(item_response.is_available);
    }

    #[tokio::test]
    async fn test_add_item_food_not_found() {
        let mock_cart_repo = MockTestCartRepository::new();
        let mut mock_food_repo = MockTestFoodRepository::new();

        mock_food_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq("F999".to_string()))
            .times(1)
            .returning(|_| Ok(None));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let request = AddCartItemRequest {
            food_id: "F999".to_string(),
            quantity: 1,
        };

        let result = service.add_item("user123", request).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ServiceError::FoodNotFound { food_id } => {
                assert_eq!(food_id, "F999");
            }
            _ => panic!("Expected FoodNotFound error"),
        }
    }

    #[tokio::test]
    async fn test_add_item_insufficient_stock() {
        let mock_cart_repo = MockTestCartRepository::new();
        let mut mock_food_repo = MockTestFoodRepository::new();
        let mut test_food = create_test_food();
        test_food.stock_quantity = 1; // Only 1 in stock

        mock_food_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq("F001".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_food.clone())));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let request = AddCartItemRequest {
            food_id: "F001".to_string(),
            quantity: 5, // Requesting more than available
        };

        let result = service.add_item("user123", request).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            ServiceError::InsufficientStock { requested, available } => {
                assert_eq!(requested, 5);
                assert_eq!(available, 1);
            }
            _ => panic!("Expected InsufficientStock error"),
        }
    }

    #[tokio::test]
    async fn test_update_item_success() {
        let mut mock_cart_repo = MockTestCartRepository::new();
        let mut mock_food_repo = MockTestFoodRepository::new();
        let test_cart = create_test_cart();
        let test_food = create_test_food();

        mock_cart_repo
            .expect_find_cart()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_cart.clone())));

        mock_cart_repo
            .expect_save_cart()
            .times(1)
            .returning(|cart| Ok(cart));

        mock_food_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq("F001".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_food.clone())));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let request = UpdateCartItemRequest { quantity: 5 };

        let result = service.update_item("user123", "F001", request).await;

        assert!(result.is_ok());
        let item_response = result.unwrap();
        assert_eq!(item_response.quantity, 5);
    }

    #[tokio::test]
    async fn test_remove_item_success() {
        let mut mock_cart_repo = MockTestCartRepository::new();
        let mock_food_repo = MockTestFoodRepository::new();
        let test_cart = create_test_cart();

        mock_cart_repo
            .expect_find_cart()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_cart.clone())));

        mock_cart_repo
            .expect_save_cart()
            .times(1)
            .returning(|cart| Ok(cart));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let result = service.remove_item("user123", "F001").await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_clear_cart_success() {
        let mut mock_cart_repo = MockTestCartRepository::new();
        let mock_food_repo = MockTestFoodRepository::new();
        let test_cart = create_test_cart();

        mock_cart_repo
            .expect_find_cart()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_cart.clone())));

        mock_cart_repo
            .expect_save_cart()
            .times(1)
            .returning(|cart| Ok(cart));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let result = service.clear_cart("user123").await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_delete_cart_success() {
        let mut mock_cart_repo = MockTestCartRepository::new();
        let mock_food_repo = MockTestFoodRepository::new();

        mock_cart_repo
            .expect_cart_exists()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(|_| Ok(true));

        mock_cart_repo
            .expect_delete_cart()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(|_| Ok(()));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let result = service.delete_cart("user123").await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_cart_with_issues() {
        let mut mock_cart_repo = MockTestCartRepository::new();
        let mut mock_food_repo = MockTestFoodRepository::new();
        let test_cart = create_test_cart();
        let mut test_food = create_test_food();
        test_food.stock_quantity = 1; // Less than cart quantity

        mock_cart_repo
            .expect_find_cart()
            .with(mockall::predicate::eq("user123".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_cart.clone())));

        mock_food_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq("F001".to_string()))
            .times(1)
            .returning(move |_| Ok(Some(test_food.clone())));

        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        let result = service.validate_cart("user123").await;

        assert!(result.is_ok());
        let issues = result.unwrap();
        assert!(!issues.is_empty());
        assert!(issues[0].contains("Insufficient stock"));
    }

    #[tokio::test]
    async fn test_validation_errors() {
        let mock_cart_repo = MockTestCartRepository::new();
        let mock_food_repo = MockTestFoodRepository::new();
        let service = CartService::new(Arc::new(mock_cart_repo), Arc::new(mock_food_repo));

        // Test empty user ID
        let result = service.get_cart("").await;
        assert!(result.is_err());

        // Test invalid quantity
        let request = AddCartItemRequest {
            food_id: "F001".to_string(),
            quantity: 0,
        };
        let result = service.add_item("user123", request).await;
        assert!(result.is_err());

        // Test excessive quantity
        let request = AddCartItemRequest {
            food_id: "F001".to_string(),
            quantity: 101,
        };
        let result = service.add_item("user123", request).await;
        assert!(result.is_err());
    }
}