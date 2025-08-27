use crate::models::{EventConfig, EventPayload, FoodEvent, SpanContextData};
use aws_sdk_eventbridge::{Client as EventBridgeClient, Error as EventBridgeError};
use aws_smithy_runtime_api::client::result::SdkError;
use aws_smithy_runtime_api::http::Response;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;
use tracing::{error, info, instrument, warn};

/// Errors that can occur during event emission
#[derive(Error, Debug)]
pub enum EventEmitterError {
    #[error("EventBridge client error: {0}")]
    EventBridge(#[from] EventBridgeError),
    #[error("EventBridge SDK error: {0}")]
    EventBridgeSdk(
        #[from] SdkError<aws_sdk_eventbridge::operation::put_events::PutEventsError, Response>,
    ),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Event emission disabled")]
    Disabled,
    #[error("Maximum retry attempts exceeded")]
    MaxRetriesExceeded,
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}

/// Service responsible for emitting events to AWS EventBridge
#[derive(Clone)]
pub struct EventEmitter {
    client: Arc<EventBridgeClient>,
    config: EventConfig,
}

impl EventEmitter {
    /// Create a new EventEmitter instance
    #[allow(clippy::result_large_err)]
    pub fn new(client: EventBridgeClient, config: EventConfig) -> Result<Self, EventEmitterError> {
        // Validate configuration
        if config.event_bus_name.is_empty() {
            return Err(EventEmitterError::InvalidConfig(
                "Event bus name cannot be empty".to_string(),
            ));
        }

        if config.source_name.is_empty() {
            return Err(EventEmitterError::InvalidConfig(
                "Source name cannot be empty".to_string(),
            ));
        }

        Ok(Self {
            client: Arc::new(client),
            config,
        })
    }

    /// Emit a food event to EventBridge with retry logic
    #[instrument(skip(self, event), fields(event_type = %event.event_type, food_id = %event.food_id))]
    pub async fn emit_event(&self, event: FoodEvent) -> Result<(), EventEmitterError> {
        if !self.config.enabled {
            warn!("Event emission is disabled, skipping event");
            return Err(EventEmitterError::Disabled);
        }

        let payload: EventPayload = event.into();

        // Emit with retry logic
        self.emit_with_retry(payload).await
    }

    /// Emit event with exponential backoff retry logic
    async fn emit_with_retry(&self, payload: EventPayload) -> Result<(), EventEmitterError> {
        let mut attempts = 0;
        let max_attempts = self.config.retry_attempts;

        while attempts < max_attempts {
            match self.send_to_eventbridge(&payload).await {
                Ok(_) => {
                    info!(
                        event_type = %payload.detail_type,
                        food_id = %payload.detail.food_id,
                        attempt = attempts + 1,
                        "Event successfully emitted to EventBridge"
                    );
                    return Ok(());
                }
                Err(e) => {
                    attempts += 1;

                    if attempts >= max_attempts {
                        error!(
                            event_type = %payload.detail_type,
                            food_id = %payload.detail.food_id,
                            attempts = attempts,
                            error = %e,
                            "Failed to emit event after maximum retry attempts"
                        );
                        return Err(EventEmitterError::MaxRetriesExceeded);
                    }

                    let delay = Duration::from_millis(100 * 2_u64.pow(attempts - 1));
                    warn!(
                        event_type = %payload.detail_type,
                        food_id = %payload.detail.food_id,
                        attempt = attempts,
                        delay_ms = delay.as_millis(),
                        error = %e,
                        "Event emission failed, retrying"
                    );

                    sleep(delay).await;
                }
            }
        }

        Err(EventEmitterError::MaxRetriesExceeded)
    }

    /// Send event to EventBridge
    async fn send_to_eventbridge(&self, payload: &EventPayload) -> Result<(), EventEmitterError> {
        let detail_json = serde_json::to_string(&payload.detail)?;

        // Convert chrono DateTime to AWS DateTime
        let aws_time = aws_smithy_types::DateTime::from_secs(payload.time.timestamp());

        let mut entry_builder = aws_sdk_eventbridge::types::PutEventsRequestEntry::builder()
            .source(&payload.source)
            .detail_type(&payload.detail_type)
            .detail(detail_json)
            .time(aws_time);

        // Add resources one by one
        for resource in &payload.resources {
            entry_builder = entry_builder.resources(resource);
        }

        let entry = entry_builder.build();

        let request_builder = self.client.put_events().entries(entry);

        let response = request_builder.send().await?;

        // Check for failed entries
        let entries = response.entries();
        for entry in entries {
            if let Some(error_code) = entry.error_code() {
                error!(
                    error_code = error_code,
                    error_message = entry.error_message().unwrap_or("Unknown error"),
                    "EventBridge entry failed"
                );
                return Err(EventEmitterError::InvalidConfig(format!(
                    "EventBridge entry failed: {} - {}",
                    error_code,
                    entry.error_message().unwrap_or("Unknown error")
                )));
            }
        }

        Ok(())
    }

    /// Extract OpenTelemetry span context from current tracing span
    pub fn extract_span_context() -> SpanContextData {
        use opentelemetry::trace::TraceContextExt;
        use tracing_opentelemetry::OpenTelemetrySpanExt;

        let current_span = tracing::Span::current();
        let context = current_span.context();

        let span = context.span();
        let span_context = span.span_context();
        if span_context.is_valid() {
            SpanContextData {
                trace_id: format!("{:032x}", span_context.trace_id()),
                span_id: format!("{:016x}", span_context.span_id()),
                trace_flags: format!("{:02x}", span_context.trace_flags()),
            }
        } else {
            // Fallback to default if no active span
            SpanContextData::default()
        }
    }

    /// Get current configuration
    pub fn config(&self) -> &EventConfig {
        &self.config
    }

    /// Update configuration (useful for feature flags)
    #[allow(clippy::result_large_err)]
    pub fn update_config(&mut self, config: EventConfig) -> Result<(), EventEmitterError> {
        if config.event_bus_name.is_empty() {
            return Err(EventEmitterError::InvalidConfig(
                "Event bus name cannot be empty".to_string(),
            ));
        }

        if config.source_name.is_empty() {
            return Err(EventEmitterError::InvalidConfig(
                "Source name cannot be empty".to_string(),
            ));
        }

        self.config = config;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FoodType, PetType};
    use aws_sdk_eventbridge::config::Region;

    #[tokio::test]
    async fn test_event_emitter_creation() {
        let config = aws_sdk_eventbridge::Config::builder()
            .region(Region::new("us-east-1"))
            .build();
        let client = EventBridgeClient::from_conf(config);

        let event_config = EventConfig::default();
        let emitter = EventEmitter::new(client, event_config);

        assert!(emitter.is_ok());
    }

    #[tokio::test]
    async fn test_invalid_config() {
        let config = aws_sdk_eventbridge::Config::builder()
            .region(Region::new("us-east-1"))
            .build();
        let client = EventBridgeClient::from_conf(config);

        let mut event_config = EventConfig::default();
        event_config.event_bus_name = "".to_string();

        let emitter = EventEmitter::new(client, event_config);

        assert!(matches!(emitter, Err(EventEmitterError::InvalidConfig(_))));
    }

    #[test]
    fn test_span_context_extraction() {
        // Test default span context when no active span
        let span_context = EventEmitter::extract_span_context();

        // Should return default values when no active span
        assert_eq!(span_context.trace_id.len(), 32);
        assert_eq!(span_context.span_id.len(), 16);
        assert_eq!(span_context.trace_flags.len(), 2);
    }

    #[tokio::test]
    async fn test_disabled_event_emission() {
        let config = aws_sdk_eventbridge::Config::builder()
            .region(Region::new("us-east-1"))
            .build();
        let client = EventBridgeClient::from_conf(config);

        let mut event_config = EventConfig::default();
        event_config.enabled = false;

        let emitter = EventEmitter::new(client, event_config).unwrap();

        let event = FoodEvent::food_item_created(
            "test-id".to_string(),
            "Test Food".to_string(),
            PetType::Puppy,
            FoodType::Dry,
            None,
            None,
            SpanContextData::default(),
        );

        let result = emitter.emit_event(event).await;
        assert!(matches!(result, Err(EventEmitterError::Disabled)));
    }

    #[test]
    fn test_config_update() {
        let config = aws_sdk_eventbridge::Config::builder()
            .region(Region::new("us-east-1"))
            .build();
        let client = EventBridgeClient::from_conf(config);

        let event_config = EventConfig::default();
        let mut emitter = EventEmitter::new(client, event_config).unwrap();

        let mut new_config = EventConfig::default();
        new_config.retry_attempts = 5;

        let result = emitter.update_config(new_config);
        assert!(result.is_ok());
        assert_eq!(emitter.config().retry_attempts, 5);
    }

    #[test]
    fn test_invalid_config_update() {
        let config = aws_sdk_eventbridge::Config::builder()
            .region(Region::new("us-east-1"))
            .build();
        let client = EventBridgeClient::from_conf(config);

        let event_config = EventConfig::default();
        let mut emitter = EventEmitter::new(client, event_config).unwrap();

        let mut invalid_config = EventConfig::default();
        invalid_config.event_bus_name = "".to_string();

        let result = emitter.update_config(invalid_config);
        assert!(matches!(result, Err(EventEmitterError::InvalidConfig(_))));
    }
}
