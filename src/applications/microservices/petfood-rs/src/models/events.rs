use crate::models::{AvailabilityStatus, FoodType, PetType};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Event types that can be emitted by the petfood service
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum FoodEventType {
    FoodItemCreated,
    FoodItemUpdated,
    ItemDiscontinued,
}

impl std::fmt::Display for FoodEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FoodEventType::FoodItemCreated => write!(f, "FoodItemCreated"),
            FoodEventType::FoodItemUpdated => write!(f, "FoodItemUpdated"),
            FoodEventType::ItemDiscontinued => write!(f, "ItemDiscontinued"),
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

impl FoodEvent {
    /// Create a new FoodItemCreated event
    pub fn food_item_created(
        food_id: String,
        food_name: String,
        pet_type: PetType,
        food_type: FoodType,
        description: Option<String>,
        ingredients: Option<Vec<String>>,
        span_context: SpanContextData,
    ) -> Self {
        let mut metadata = HashMap::new();
        metadata.insert("image_required".to_string(), "true".to_string());

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

    /// Create a new FoodItemUpdated event
    #[allow(clippy::too_many_arguments)]
    pub fn food_item_updated(
        food_id: String,
        food_name: Option<String>,
        pet_type: Option<PetType>,
        food_type: Option<FoodType>,
        description: Option<String>,
        ingredients: Option<Vec<String>>,
        previous_image_path: Option<String>,
        span_context: SpanContextData,
    ) -> Self {
        let mut metadata = HashMap::new();
        metadata.insert("image_required".to_string(), "true".to_string());

        if let Some(prev_path) = previous_image_path {
            metadata.insert("previous_image_path".to_string(), prev_path);
        }

        Self {
            event_type: FoodEventType::FoodItemUpdated,
            food_id,
            food_name,
            pet_type,
            food_type,
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
pub struct EventDetail {
    pub event_type: String,
    pub food_id: String,
    pub food_name: Option<String>,
    pub pet_type: Option<PetType>,
    pub food_type: Option<FoodType>,
    pub description: Option<String>,
    pub ingredients: Option<Vec<String>>,
    pub status: Option<AvailabilityStatus>,
    pub metadata: HashMap<String, String>,
    pub span_context: SpanContextData,
}

impl From<FoodEvent> for EventPayload {
    fn from(event: FoodEvent) -> Self {
        let detail = EventDetail {
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
            span_context.clone(),
        );

        assert_eq!(event.event_type, FoodEventType::FoodItemCreated);
        assert_eq!(event.food_id, "test-id");
        assert_eq!(event.food_name, Some("Test Food".to_string()));
        assert_eq!(event.pet_type, Some(PetType::Puppy));
        assert_eq!(event.food_type, Some(FoodType::Dry));
        assert_eq!(event.span_context, span_context);
        assert!(event.metadata.contains_key("image_required"));
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
            span_context,
        );

        let payload: EventPayload = event.into();

        assert_eq!(payload.source, "petfood.service");
        assert_eq!(payload.detail_type, "FoodItemCreated");
        assert_eq!(payload.detail.food_id, "test-id");
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
}
