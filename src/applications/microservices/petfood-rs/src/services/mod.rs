// Services module - business logic layer

pub mod cart_service;
pub mod event_emitter;
pub mod food_service;

pub use cart_service::CartService;
pub use event_emitter::{EventEmitter, EventEmitterError};
pub use food_service::FoodService;
