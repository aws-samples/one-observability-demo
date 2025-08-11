// Services module - business logic layer

pub mod food_service;
pub mod recommendation_service;
pub mod cart_service;

pub use food_service::FoodService;
pub use recommendation_service::{RecommendationService, RecommendationStats};
pub use cart_service::CartService;