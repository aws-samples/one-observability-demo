use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Shopping cart for a user
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cart {
    pub user_id: String,
    pub items: Vec<CartItem>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Individual item in a shopping cart
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CartItem {
    pub food_id: String,
    pub quantity: u32,
    pub unit_price: Decimal,
    pub added_at: DateTime<Utc>,
}

/// Request model for adding an item to cart
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddCartItemRequest {
    pub food_id: String,
    pub quantity: u32,
}

/// Request model for updating cart item quantity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCartItemRequest {
    pub quantity: u32,
}

/// Response model for cart operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartResponse {
    pub user_id: String,
    pub items: Vec<CartItemResponse>,
    pub total_items: u32,
    pub total_price: Decimal,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Enhanced cart item response with food details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CartItemResponse {
    pub food_id: String,
    pub food_name: String,
    pub food_image: String,
    pub quantity: u32,
    pub unit_price: Decimal,
    pub total_price: Decimal,
    pub is_available: bool,
    pub added_at: DateTime<Utc>,
}

impl Cart {
    /// Create a new empty cart for a user
    pub fn new(user_id: String) -> Self {
        let now = Utc::now();
        Self {
            user_id,
            items: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    /// Add an item to the cart or update quantity if it already exists
    pub fn add_item(&mut self, food_id: String, quantity: u32, unit_price: Decimal) {
        if let Some(existing_item) = self.items.iter_mut().find(|item| item.food_id == food_id) {
            existing_item.quantity += quantity;
        } else {
            let item = CartItem {
                food_id,
                quantity,
                unit_price,
                added_at: Utc::now(),
            };
            self.items.push(item);
        }
        self.updated_at = Utc::now();
    }

    /// Update the quantity of a specific item in the cart
    pub fn update_item_quantity(&mut self, food_id: &str, new_quantity: u32) -> bool {
        if let Some(item) = self.items.iter_mut().find(|item| item.food_id == food_id) {
            if new_quantity == 0 {
                self.remove_item(food_id)
            } else {
                item.quantity = new_quantity;
                self.updated_at = Utc::now();
                true
            }
        } else {
            false
        }
    }

    /// Remove an item from the cart
    pub fn remove_item(&mut self, food_id: &str) -> bool {
        let original_len = self.items.len();
        self.items.retain(|item| item.food_id != food_id);
        let removed = self.items.len() != original_len;
        if removed {
            self.updated_at = Utc::now();
        }
        removed
    }

    /// Clear all items from the cart
    pub fn clear(&mut self) {
        self.items.clear();
        self.updated_at = Utc::now();
    }

    /// Get the total number of items in the cart
    pub fn total_items(&self) -> u32 {
        self.items.iter().map(|item| item.quantity).sum()
    }

    /// Get the total price of all items in the cart
    pub fn total_price(&self) -> Decimal {
        self.items
            .iter()
            .map(|item| item.unit_price * Decimal::from(item.quantity))
            .sum()
    }

    /// Check if the cart is empty
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Get a specific item from the cart
    pub fn get_item(&self, food_id: &str) -> Option<&CartItem> {
        self.items.iter().find(|item| item.food_id == food_id)
    }

    /// Check if a specific food item is in the cart
    pub fn contains_item(&self, food_id: &str) -> bool {
        self.items.iter().any(|item| item.food_id == food_id)
    }

    /// Get the quantity of a specific item in the cart
    pub fn get_item_quantity(&self, food_id: &str) -> u32 {
        self.get_item(food_id).map(|item| item.quantity).unwrap_or(0)
    }
}

impl CartItem {
    /// Create a new cart item
    pub fn new(food_id: String, quantity: u32, unit_price: Decimal) -> Self {
        Self {
            food_id,
            quantity,
            unit_price,
            added_at: Utc::now(),
        }
    }

    /// Get the total price for this cart item (unit_price * quantity)
    pub fn total_price(&self) -> Decimal {
        self.unit_price * Decimal::from(self.quantity)
    }

    /// Update the quantity of this cart item
    pub fn update_quantity(&mut self, new_quantity: u32) {
        self.quantity = new_quantity;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_cart_creation() {
        let cart = Cart::new("user123".to_string());
        
        assert_eq!(cart.user_id, "user123");
        assert!(cart.items.is_empty());
        assert!(cart.is_empty());
        assert_eq!(cart.total_items(), 0);
        assert_eq!(cart.total_price(), dec!(0));
    }

    #[test]
    fn test_add_item_to_cart() {
        let mut cart = Cart::new("user123".to_string());
        
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        
        assert_eq!(cart.items.len(), 1);
        assert_eq!(cart.total_items(), 2);
        assert_eq!(cart.total_price(), dec!(25.98));
        assert!(cart.contains_item("F001"));
        assert_eq!(cart.get_item_quantity("F001"), 2);
    }

    #[test]
    fn test_add_existing_item_updates_quantity() {
        let mut cart = Cart::new("user123".to_string());
        
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        cart.add_item("F001".to_string(), 3, dec!(12.99));
        
        assert_eq!(cart.items.len(), 1);
        assert_eq!(cart.total_items(), 5);
        assert_eq!(cart.get_item_quantity("F001"), 5);
    }

    #[test]
    fn test_update_item_quantity() {
        let mut cart = Cart::new("user123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        
        let updated = cart.update_item_quantity("F001", 5);
        assert!(updated);
        assert_eq!(cart.get_item_quantity("F001"), 5);
        
        let not_found = cart.update_item_quantity("F999", 1);
        assert!(!not_found);
    }

    #[test]
    fn test_update_quantity_to_zero_removes_item() {
        let mut cart = Cart::new("user123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        
        let updated = cart.update_item_quantity("F001", 0);
        assert!(updated);
        assert!(!cart.contains_item("F001"));
        assert!(cart.is_empty());
    }

    #[test]
    fn test_remove_item() {
        let mut cart = Cart::new("user123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        cart.add_item("F002".to_string(), 1, dec!(8.99));
        
        let removed = cart.remove_item("F001");
        assert!(removed);
        assert!(!cart.contains_item("F001"));
        assert_eq!(cart.items.len(), 1);
        
        let not_found = cart.remove_item("F999");
        assert!(!not_found);
    }

    #[test]
    fn test_clear_cart() {
        let mut cart = Cart::new("user123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        cart.add_item("F002".to_string(), 1, dec!(8.99));
        
        cart.clear();
        
        assert!(cart.is_empty());
        assert_eq!(cart.total_items(), 0);
        assert_eq!(cart.total_price(), dec!(0));
    }

    #[test]
    fn test_cart_item_total_price() {
        let item = CartItem::new("F001".to_string(), 3, dec!(12.99));
        assert_eq!(item.total_price(), dec!(38.97));
    }

    #[test]
    fn test_multiple_items_total_calculation() {
        let mut cart = Cart::new("user123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        cart.add_item("F002".to_string(), 1, dec!(8.99));
        cart.add_item("F003".to_string(), 3, dec!(5.50));
        
        assert_eq!(cart.total_items(), 6);
        assert_eq!(cart.total_price(), dec!(51.47)); // 25.98 + 8.99 + 16.50
    }

    #[test]
    fn test_serde_serialization() {
        let mut cart = Cart::new("user123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        
        let json = serde_json::to_string(&cart).unwrap();
        let deserialized: Cart = serde_json::from_str(&json).unwrap();
        
        assert_eq!(cart, deserialized);
    }
}

// CHECKOUT MODELS

/// Request model for checkout
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckoutRequest {
    pub payment_method: PaymentMethod,
    pub shipping_address: Option<ShippingAddress>,
    pub billing_address: Option<BillingAddress>,
}

/// Payment method for checkout
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PaymentMethod {
    CreditCard {
        card_number: String,
        expiry_month: u8,
        expiry_year: u16,
        cvv: String,
        cardholder_name: String,
    },
    PayPal {
        email: String,
    },
    BankTransfer {
        account_number: String,
        routing_number: String,
    },
}

/// Shipping address for checkout
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShippingAddress {
    pub name: String,
    pub street: String,
    pub city: String,
    pub state: String,
    pub zip_code: String,
    pub country: String,
}

/// Billing address for checkout
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingAddress {
    pub name: String,
    pub street: String,
    pub city: String,
    pub state: String,
    pub zip_code: String,
    pub country: String,
}

/// Response model for successful checkout
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckoutResponse {
    pub order_id: String,
    pub user_id: String,
    pub items: Vec<OrderItem>,
    pub subtotal: Decimal,
    pub tax: Decimal,
    pub shipping: Decimal,
    pub total_amount: Decimal,
    pub payment_method: String,
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
    pub estimated_delivery: Option<DateTime<Utc>>,
}

/// Order item in checkout response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderItem {
    pub food_id: String,
    pub food_name: String,
    pub quantity: u32,
    pub unit_price: Decimal,
    pub total_price: Decimal,
}

/// Order status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderStatus {
    Pending,
    Confirmed,
    Processing,
    Shipped,
    Delivered,
    Cancelled,
}

impl std::fmt::Display for OrderStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrderStatus::Pending => write!(f, "pending"),
            OrderStatus::Confirmed => write!(f, "confirmed"),
            OrderStatus::Processing => write!(f, "processing"),
            OrderStatus::Shipped => write!(f, "shipped"),
            OrderStatus::Delivered => write!(f, "delivered"),
            OrderStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl Default for OrderStatus {
    fn default() -> Self {
        OrderStatus::Pending
    }
}