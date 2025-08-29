use crate::models::{EventConfig, EventPayload, FoodEvent, SpanContextData};

#[cfg(test)]
use crate::models::CreationSource;
use aws_sdk_eventbridge::operation::RequestId;
use aws_sdk_eventbridge::{Client as EventBridgeClient, Error as EventBridgeError};
use aws_smithy_runtime_api::client::result::SdkError;
use aws_smithy_runtime_api::http::Response;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;
use tracing::{error, info, instrument, warn, Instrument};

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
    #[instrument(
        skip(self, event),
        fields(
            event_type = %event.event_type,
            food_id = %event.food_id,
            event_bus = %self.config.event_bus_name,
            source = %self.config.source_name,
            span.kind = "client"
        )
    )]
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

    /// Create an EventBridge subsegment span with proper X-Ray attributes
    fn create_eventbridge_span(&self, operation: &str) -> tracing::Span {
        let region = self
            .client
            .config()
            .region()
            .map(|r| r.as_ref())
            .unwrap_or("unknown");

        tracing::info_span!(
            "EventBridge",
            // AWS X-Ray specific attributes
            "aws.service" = "EventBridge",
            "aws.operation" = operation,
            "aws.region" = %region,
            "aws.eventbridge.event_bus_name" = %self.config.event_bus_name,
            "aws.request_id" = tracing::field::Empty,
            "aws.agent" = "rust-aws-sdk",

            // Resource identification for X-Ray
            "aws.remote.service" = "AWS::EventBridge",
            "aws.remote.operation" = operation,
            "aws.remote.resource.type" = "AWS::EventBridge::EventBus",
            "aws.remote.resource.identifier" = %self.config.event_bus_name,
            "remote.resource.cfn.primary.identifier" = %self.config.event_bus_name,

            // EventBridge-specific attributes
            "event_bus_name" = %self.config.event_bus_name,
            "event_bus.name" = %self.config.event_bus_name,
            "resource_names" = format!("[{}]", self.config.event_bus_name),
            "endpoint" = format!("https://events.{}.amazonaws.com", region),

            // OpenTelemetry semantic conventions
            "otel.kind" = "client",
            "otel.name" = format!("EventBridge.{}", operation),

            // RPC semantic conventions for AWS API calls
            "rpc.system" = "aws-api",
            "rpc.service" = "AmazonEventBridge",
            "rpc.method" = operation,

            // HTTP semantic conventions (AWS APIs are HTTP-based)
            "http.method" = "POST",
            "http.url" = format!("https://events.{}.amazonaws.com", region),
            "http.status_code" = tracing::field::Empty,

            // Messaging semantic conventions
            "messaging.system" = "aws_eventbridge",
            "messaging.destination.name" = %self.config.event_bus_name,
            "messaging.operation" = "publish",

            // Component identification for X-Ray
            "component" = "aws-sdk-eventbridge",
        )
    }

    /// Send event to EventBridge
    #[instrument(
        skip(self, payload),
        fields(
            event_source = %payload.source,
            event_type = %payload.detail_type,
            food_id = %payload.detail.food_id
        )
    )]
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

        // Create EventBridge remote span
        let put_events_span = self.create_eventbridge_span("PutEvents");

        let response = async {
            let result = self.client.put_events().entries(entry).send().await;

            // Record additional span attributes based on response
            match &result {
                Ok(output) => {
                    tracing::Span::current().record("http.status_code", 200);
                    if let Some(request_id) = output.request_id() {
                        tracing::Span::current().record("aws.request_id", request_id);
                    }

                    // Record batch information
                    let entries = output.entries();
                    tracing::Span::current()
                        .record("messaging.batch.message_count", entries.len() as u64);

                    // Count failed entries
                    let failed_count = entries
                        .iter()
                        .filter(|entry| entry.error_code().is_some())
                        .count();

                    if failed_count > 0 {
                        tracing::Span::current()
                            .record("eventbridge.failed_entries", failed_count as u64);
                        tracing::Span::current().record("error", true);
                    }

                    tracing::Span::current().record(
                        "eventbridge.successful_entries",
                        (entries.len() - failed_count) as u64,
                    );
                }
                Err(e) => {
                    tracing::Span::current().record("http.status_code", 400); // Generic error code
                    tracing::Span::current().record("error", true);
                    tracing::Span::current().record("error.message", e.to_string().as_str());
                    error!("EventBridge PutEvents failed: {}", e);
                }
            }

            result.map_err(EventEmitterError::EventBridgeSdk)
        }
        .instrument(put_events_span)
        .await?;

        // Check for failed entries and handle them
        let entries = response.entries();
        let mut failed_count = 0;
        for entry in entries {
            if let Some(error_code) = entry.error_code() {
                failed_count += 1;
                error!(
                    error_code = error_code,
                    error_message = entry.error_message().unwrap_or("Unknown error"),
                    "EventBridge entry failed"
                );
            }
        }

        if failed_count > 0 {
            let error_msg = format!("EventBridge had {} failed entries", failed_count);
            return Err(EventEmitterError::InvalidConfig(error_msg));
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

        let event_config = EventConfig {
            event_bus_name: "".to_string(),
            ..Default::default()
        };

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

        let event_config = EventConfig {
            enabled: false,
            ..Default::default()
        };

        let emitter = EventEmitter::new(client, event_config).unwrap();

        let event = FoodEvent::food_item_created(
            "test-id".to_string(),
            "Test Food".to_string(),
            PetType::Puppy,
            FoodType::Dry,
            None,
            None,
            CreationSource::AdminApi,
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

        let new_config = EventConfig {
            retry_attempts: 5,
            ..Default::default()
        };

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

        let invalid_config = EventConfig {
            event_bus_name: "".to_string(),
            ..Default::default()
        };

        let result = emitter.update_config(invalid_config);
        assert!(matches!(result, Err(EventEmitterError::InvalidConfig(_))));
    }
}
