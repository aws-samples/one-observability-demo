use crate::models::{AvailabilityStatus, FoodType, PetType};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Source of food item creation
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreationSource {
    /// Created via admin API endpoint
    AdminApi,
    /// missing images when using food APIs
    FoodApi,
}

impl std::fmt::Display for CreationSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CreationSource::AdminApi => write!(f, "admin_api"),
            CreationSource::FoodApi => write!(f, "food_api"),
        }
    }
}

/// Event types that can be emitted by the petfood service
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum FoodEventType {
    FoodItemCreated,
    ItemDiscontinued,
    StockPurchased,
}

impl std::fmt::Display for FoodEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FoodEventType::FoodItemCreated => write!(f, "FoodItemCreated"),
            FoodEventType::ItemDiscontinued => write!(f, "ItemDiscontinued"),
            FoodEventType::StockPurchased => write!(f, "StockPurchased"),
        }
    }
}

/// OpenTelemetry span context data for distributed tracing
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpanContextData {
    pub trace_id: String,
    pub span_id: String,
    pub trace_flags: String,
}

impl Default for SpanContextData {
    fn default() -> Self {
        Self {
            trace_id: "00000000000000000000000000000000".to_string(),
            span_id: "0000000000000000".to_string(),
            trace_flags: "00".to_string(),
        }
    }
}

/// Stock purchase item for tracking individual purchases
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StockPurchaseItem {
    pub food_id: String,
    pub food_name: String,
    pub quantity: i32,
    pub unit_price: Decimal,
    pub total_price: Decimal,
}

/// Core event structure for food-related events
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoodEvent {
    pub event_type: FoodEventType,
    pub food_id: String,
    pub food_name: Option<String>,
    pub pet_type: Option<PetType>,
    pub food_type: Option<FoodType>,
    pub description: Option<String>,
    pub ingredients: Option<Vec<String>>,
    pub status: Option<AvailabilityStatus>,
    pub metadata: HashMap<String, String>,
    pub span_context: SpanContextData,
    pub timestamp: DateTime<Utc>,
}

/// Stock purchase event structure for tracking purchases that need stock reduction
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StockPurchaseEvent {
    pub event_type: FoodEventType,
    pub order_id: String,
    pub user_id: String,
    pub items: Vec<StockPurchaseItem>,
    pub total_amount: Decimal,
    pub metadata: HashMap<String, String>,
    pub span_context: SpanContextData,
    pub timestamp: DateTime<Utc>,
}

impl FoodEvent {
    /// Create a new FoodItemCreated event
    #[allow(clippy::too_many_arguments)]
    pub fn food_item_created(
        food_id: String,
        food_name: String,
        pet_type: PetType,
        food_type: FoodType,
        description: Option<String>,
        ingredients: Option<Vec<String>>,
        creation_source: CreationSource,
        span_context: SpanContextData,
    ) -> Self {
        let mut metadata = HashMap::new();
        metadata.insert("image_required".to_string(), "true".to_string());
        metadata.insert("creation_source".to_string(), creation_source.to_string());

        // Add additional metadata based on creation source
        match creation_source {
            CreationSource::AdminApi => {
                metadata.insert("is_manual_creation".to_string(), "true".to_string());
                metadata.insert("is_seed_data".to_string(), "false".to_string());
                metadata.insert("requires_validation".to_string(), "true".to_string());
            }
            CreationSource::FoodApi => {
                metadata.insert("is_manual_creation".to_string(), "false".to_string());
                metadata.insert("is_seed_data".to_string(), "true".to_string());
                metadata.insert("requires_validation".to_string(), "false".to_string());
            }
        }

        Self {
            event_type: FoodEventType::FoodItemCreated,
            food_id,
            food_name: Some(food_name),
            pet_type: Some(pet_type),
            food_type: Some(food_type),
            description,
            ingredients,
            status: None,
            metadata,
            span_context,
            timestamp: Utc::now(),
        }
    }

    /// Create a new ItemDiscontinued event
    pub fn item_discontinued(
        food_id: String,
        status: AvailabilityStatus,
        image_path: Option<String>,
        cleanup_type: String,
        span_context: SpanContextData,
    ) -> Self {
        let mut metadata = HashMap::new();
        metadata.insert("cleanup_type".to_string(), cleanup_type);
        metadata.insert("reason".to_string(), "cleanup_operation".to_string());

        if let Some(img_path) = image_path {
            metadata.insert("image_path".to_string(), img_path);
        }

        Self {
            event_type: FoodEventType::ItemDiscontinued,
            food_id,
            food_name: None,
            pet_type: None,
            food_type: None,
            description: None,
            ingredients: None,
            status: Some(status),
            metadata,
            span_context,
            timestamp: Utc::now(),
        }
    }
}

impl StockPurchaseEvent {
    /// Create a new StockPurchased event
    pub fn stock_purchased(
        order_id: String,
        user_id: String,
        items: Vec<StockPurchaseItem>,
        total_amount: Decimal,
        span_context: SpanContextData,
    ) -> Self {
        let mut metadata = HashMap::new();
        metadata.insert("order_id".to_string(), order_id.clone());
        metadata.insert("user_id".to_string(), user_id.clone());
        metadata.insert("item_count".to_string(), items.len().to_string());
        metadata.insert("requires_stock_reduction".to_string(), "true".to_string());
        metadata.insert("processing_type".to_string(), "async".to_string());

        Self {
            event_type: FoodEventType::StockPurchased,
            order_id,
            user_id,
            items,
            total_amount,
            metadata,
            span_context,
            timestamp: Utc::now(),
        }
    }
}

/// EventBridge event payload structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventPayload {
    pub source: String,
    #[serde(rename = "detail-type")]
    pub detail_type: String,
    pub detail: EventDetail,
    pub resources: Vec<String>,
    pub time: DateTime<Utc>,
}

/// Event detail structure for EventBridge
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EventDetail {
    Food {
        event_type: String,
        food_id: String,
        food_name: Option<String>,
        pet_type: Option<PetType>,
        food_type: Option<FoodType>,
        description: Option<String>,
        ingredients: Option<Vec<String>>,
        status: Option<AvailabilityStatus>,
        metadata: HashMap<String, String>,
        span_context: SpanContextData,
    },
    StockPurchase {
        event_type: String,
        order_id: String,
        user_id: String,
        items: Vec<StockPurchaseItem>,
        total_amount: Decimal,
        metadata: HashMap<String, String>,
        span_context: SpanContextData,
    },
}

impl From<FoodEvent> for EventPayload {
    fn from(event: FoodEvent) -> Self {
        let detail = EventDetail::Food {
            event_type: event.event_type.to_string(),
            food_id: event.food_id.clone(),
            food_name: event.food_name.clone(),
            pet_type: event.pet_type.clone(),
            food_type: event.food_type.clone(),
            description: event.description.clone(),
            ingredients: event.ingredients.clone(),
            status: event.status.clone(),
            metadata: event.metadata.clone(),
            span_context: event.span_context.clone(),
        };

        Self {
            source: "petfood.service".to_string(),
            detail_type: event.event_type.to_string(),
            detail,
            resources: vec![format!("food/{}", event.food_id)],
            time: event.timestamp,
        }
    }
}

impl From<StockPurchaseEvent> for EventPayload {
    fn from(event: StockPurchaseEvent) -> Self {
        let detail = EventDetail::StockPurchase {
            event_type: event.event_type.to_string(),
            order_id: event.order_id.clone(),
            user_id: event.user_id.clone(),
            items: event.items.clone(),
            total_amount: event.total_amount,
            metadata: event.metadata.clone(),
            span_context: event.span_context.clone(),
        };

        let resources = event
            .items
            .iter()
            .map(|item| format!("food/{}", item.food_id))
            .collect();

        Self {
            source: "petfood.service".to_string(),
            detail_type: event.event_type.to_string(),
            detail,
            resources,
            time: event.timestamp,
        }
    }
}

/// Configuration for EventBridge settings
#[derive(Debug, Clone)]
pub struct EventConfig {
    pub event_bus_name: String,
    pub source_name: String,
    pub retry_attempts: u32,
    pub timeout_seconds: u64,
    pub enable_dead_letter_queue: bool,
    pub enabled: bool,
}

impl Default for EventConfig {
    fn default() -> Self {
        Self {
            event_bus_name: "default".to_string(),
            source_name: "petfood.service".to_string(),
            retry_attempts: 3,
            timeout_seconds: 30,
            enable_dead_letter_queue: true,
            enabled: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn test_food_event_creation() {
        let span_context = SpanContextData::default();

        let event = FoodEvent::food_item_created(
            "test-id".to_string(),
            "Test Food".to_string(),
            PetType::Puppy,
            FoodType::Dry,
            Some("Test description".to_string()),
            Some(vec!["beef".to_string(), "rice".to_string()]),
            CreationSource::AdminApi,
            span_context.clone(),
        );

        assert_eq!(event.event_type, FoodEventType::FoodItemCreated);
        assert_eq!(event.food_id, "test-id");
        assert_eq!(event.food_name, Some("Test Food".to_string()));
        assert_eq!(event.pet_type, Some(PetType::Puppy));
        assert_eq!(event.food_type, Some(FoodType::Dry));
        assert_eq!(event.span_context, span_context);
        assert!(event.metadata.contains_key("image_required"));
        assert_eq!(
            event.metadata.get("creation_source"),
            Some(&"admin_api".to_string())
        );
        assert_eq!(
            event.metadata.get("is_manual_creation"),
            Some(&"true".to_string())
        );
        assert_eq!(
            event.metadata.get("requires_validation"),
            Some(&"true".to_string())
        );
    }

    #[test]
    fn test_item_discontinued_event() {
        let span_context = SpanContextData::default();

        let event = FoodEvent::item_discontinued(
            "test-id".to_string(),
            AvailabilityStatus::Discontinued,
            Some("images/test.jpg".to_string()),
            "soft_delete".to_string(),
            span_context.clone(),
        );

        assert_eq!(event.event_type, FoodEventType::ItemDiscontinued);
        assert_eq!(event.food_id, "test-id");
        assert_eq!(event.status, Some(AvailabilityStatus::Discontinued));
        assert_eq!(
            event.metadata.get("cleanup_type"),
            Some(&"soft_delete".to_string())
        );
        assert_eq!(
            event.metadata.get("image_path"),
            Some(&"images/test.jpg".to_string())
        );
    }

    #[test]
    fn test_event_payload_conversion() {
        let span_context = SpanContextData::default();

        let event = FoodEvent::food_item_created(
            "test-id".to_string(),
            "Test Food".to_string(),
            PetType::Puppy,
            FoodType::Dry,
            None,
            None,
            CreationSource::AdminApi,
            span_context,
        );

        let payload: EventPayload = event.into();

        assert_eq!(payload.source, "petfood.service");
        assert_eq!(payload.detail_type, "FoodItemCreated");

        // Check the detail is a Food variant with correct food_id
        match &payload.detail {
            EventDetail::Food { food_id, .. } => {
                assert_eq!(food_id, "test-id");
            }
            _ => panic!("Expected Food event detail"),
        }

        assert_eq!(payload.resources, vec!["food/test-id"]);
    }

    #[test]
    fn test_event_serialization() {
        let span_context = SpanContextData::default();

        let event = FoodEvent::food_item_created(
            "test-id".to_string(),
            "Test Food".to_string(),
            PetType::Puppy,
            FoodType::Dry,
            None,
            None,
            CreationSource::AdminApi,
            span_context,
        );

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: FoodEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(event.event_type, deserialized.event_type);
        assert_eq!(event.food_id, deserialized.food_id);
    }

    #[test]
    fn test_span_context_default() {
        let span_context = SpanContextData::default();

        assert_eq!(span_context.trace_id, "00000000000000000000000000000000");
        assert_eq!(span_context.span_id, "0000000000000000");
        assert_eq!(span_context.trace_flags, "00");
    }

    #[test]
    fn test_creation_source_metadata() {
        let span_context = SpanContextData::default();

        // Test AdminApi creation source
        let admin_event = FoodEvent::food_item_created(
            "admin-id".to_string(),
            "Admin Food".to_string(),
            PetType::Puppy,
            FoodType::Dry,
            None,
            None,
            CreationSource::AdminApi,
            span_context.clone(),
        );

        assert_eq!(
            admin_event.metadata.get("creation_source"),
            Some(&"admin_api".to_string())
        );
        assert_eq!(
            admin_event.metadata.get("is_manual_creation"),
            Some(&"true".to_string())
        );
        assert_eq!(
            admin_event.metadata.get("requires_validation"),
            Some(&"true".to_string())
        );

        // Test Seeding creation source
        let seed_event = FoodEvent::food_item_created(
            "seed-id".to_string(),
            "Seed Food".to_string(),
            PetType::Puppy,
            FoodType::Dry,
            None,
            None,
            CreationSource::FoodApi,
            span_context.clone(),
        );

        assert_eq!(
            seed_event.metadata.get("creation_source"),
            Some(&"food_api".to_string())
        );
        assert_eq!(
            seed_event.metadata.get("is_manual_creation"),
            Some(&"false".to_string())
        );
        assert_eq!(
            seed_event.metadata.get("is_seed_data"),
            Some(&"true".to_string())
        );
        assert_eq!(
            seed_event.metadata.get("requires_validation"),
            Some(&"false".to_string())
        );
    }

    #[test]
    fn test_creation_source_display() {
        assert_eq!(CreationSource::AdminApi.to_string(), "admin_api");
        assert_eq!(CreationSource::FoodApi.to_string(), "food_api");
    }

    #[test]
    fn test_stock_purchase_event_creation() {
        let span_context = SpanContextData::default();
        let items = vec![
            StockPurchaseItem {
                food_id: "F001".to_string(),
                food_name: "Premium Dog Food".to_string(),
                quantity: 2,
                unit_price: Decimal::from_str("12.99").unwrap(),
                total_price: Decimal::from_str("25.98").unwrap(),
            },
            StockPurchaseItem {
                food_id: "F002".to_string(),
                food_name: "Cat Treats".to_string(),
                quantity: 1,
                unit_price: Decimal::from_str("8.99").unwrap(),
                total_price: Decimal::from_str("8.99").unwrap(),
            },
        ];

        let event = StockPurchaseEvent::stock_purchased(
            "ORDER-USER123-1234567890".to_string(),
            "user123".to_string(),
            items.clone(),
            Decimal::from_str("34.97").unwrap(),
            span_context.clone(),
        );

        assert_eq!(event.event_type, FoodEventType::StockPurchased);
        assert_eq!(event.order_id, "ORDER-USER123-1234567890");
        assert_eq!(event.user_id, "user123");
        assert_eq!(event.items.len(), 2);
        assert_eq!(event.total_amount, Decimal::from_str("34.97").unwrap());
        assert_eq!(event.span_context, span_context);
        assert!(event.metadata.contains_key("requires_stock_reduction"));
        assert_eq!(
            event.metadata.get("requires_stock_reduction"),
            Some(&"true".to_string())
        );
        assert_eq!(
            event.metadata.get("processing_type"),
            Some(&"async".to_string())
        );
    }

    #[test]
    fn test_stock_purchase_event_payload_conversion() {
        let span_context = SpanContextData::default();
        let items = vec![StockPurchaseItem {
            food_id: "F001".to_string(),
            food_name: "Premium Dog Food".to_string(),
            quantity: 2,
            unit_price: Decimal::from_str("12.99").unwrap(),
            total_price: Decimal::from_str("25.98").unwrap(),
        }];

        let event = StockPurchaseEvent::stock_purchased(
            "ORDER-USER123-1234567890".to_string(),
            "user123".to_string(),
            items,
            Decimal::from_str("25.98").unwrap(),
            span_context,
        );

        let payload: EventPayload = event.into();

        assert_eq!(payload.source, "petfood.service");
        assert_eq!(payload.detail_type, "StockPurchased");

        // Check the detail is a StockPurchase variant with correct order_id
        match &payload.detail {
            EventDetail::StockPurchase {
                order_id,
                user_id,
                items,
                ..
            } => {
                assert_eq!(order_id, "ORDER-USER123-1234567890");
                assert_eq!(user_id, "user123");
                assert_eq!(items.len(), 1);
                assert_eq!(items[0].food_id, "F001");
            }
            _ => panic!("Expected StockPurchase event detail"),
        }

        assert_eq!(payload.resources, vec!["food/F001"]);
    }
}
