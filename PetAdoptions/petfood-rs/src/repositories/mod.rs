// Repositories module - data access layer

pub mod food_repository;
pub mod cart_repository;
pub mod table_manager;

#[cfg(test)]
mod tests;

pub use food_repository::{FoodRepository, DynamoDbFoodRepository};
pub use cart_repository::{CartRepository, DynamoDbCartRepository};
pub use table_manager::TableManager;