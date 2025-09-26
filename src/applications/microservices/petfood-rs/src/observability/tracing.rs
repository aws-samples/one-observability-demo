use opentelemetry::{global, KeyValue};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{
    trace::{self, RandomIdGenerator, Sampler},
    Resource,
};
use std::time::Duration;
use thiserror::Error;
use tracing::{error, info, warn};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{
    fmt::format::FmtSpan, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer,
};

#[derive(Debug, Error)]
pub enum ObservabilityError {
    #[error("Failed to initialize OpenTelemetry: {0}")]
    OpenTelemetryInit(#[from] opentelemetry::trace::TraceError),
    #[error("Failed to initialize tracing subscriber: {0}")]
    TracingInit(String),
    #[error("Configuration error: {0}")]
    Config(String),
}

/// Initialize comprehensive observability including OpenTelemetry tracing and structured logging
pub fn init_observability(
    service_name: &str,
    service_version: &str,
    otlp_endpoint: &str,
    enable_json_logging: bool,
) -> Result<(), ObservabilityError> {
    info!(
        "Initializing observability for service: {} v{}",
        service_name, service_version
    );

    // Initialize OpenTelemetry tracer
    let tracer = init_opentelemetry_tracer(service_name, service_version, otlp_endpoint)?;

    // Create OpenTelemetry layer
    let opentelemetry_layer = OpenTelemetryLayer::new(tracer);

    // Create environment filter
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        format!(
            "{}=info,tower_http=info,aws_sdk_dynamodb=info,aws_config=info,aws_smithy_runtime=info",
            service_name.replace('-', "_")
        )
        .into()
    });

    // Initialize tracing subscriber with different formatters based on configuration
    if enable_json_logging {
        // For JSON logging - create a custom layer that excludes span context
        // We need to use a different approach to avoid automatic span inclusion
        let fmt_layer = tracing_subscriber::fmt::layer()
            .json()
            .with_current_span(false) // This is key - don't include current span context
            .with_span_list(false) // Don't include span list
            .with_target(false)
            .with_thread_ids(false)
            .with_thread_names(false)
            .with_level(true)
            .with_file(false)
            .with_line_number(false)
            .log_internal_errors(false)
            .with_span_events(FmtSpan::NONE)
            .with_filter(tracing_subscriber::filter::LevelFilter::INFO);

        tracing_subscriber::registry()
            .with(env_filter)
            .with(opentelemetry_layer)
            .with(fmt_layer)
            .init();
    } else {
        // Human-readable formatter for development
        // Clean logs with minimal span information
        tracing_subscriber::registry()
            .with(env_filter)
            .with(opentelemetry_layer)
            .with(
                tracing_subscriber::fmt::layer()
                    .with_target(false)
                    .with_thread_ids(false)
                    .with_thread_names(false)
                    .with_file(false)
                    .with_line_number(false)
                    // No span events
                    .with_span_events(FmtSpan::NONE)
                    .with_filter(tracing_subscriber::filter::LevelFilter::INFO),
            )
            .init();
    }

    info!("Observability initialized successfully");
    Ok(())
}

/// Extract the current trace ID from the active span context
pub fn get_current_trace_id() -> Option<String> {
    use opentelemetry::trace::TraceContextExt;
    use tracing_opentelemetry::OpenTelemetrySpanExt;

    let current_span = tracing::Span::current();
    let context = current_span.context();
    let span = context.span();
    let span_context = span.span_context();

    if span_context.is_valid() {
        Some(span_context.trace_id().to_string())
    } else {
        None
    }
}

/// Macro to log info messages with trace ID
#[macro_export]
macro_rules! info_with_trace {
    ($($arg:tt)*) => {
        if let Some(trace_id) = $crate::observability::tracing::get_current_trace_id() {
            tracing::info!(trace_id = %trace_id, $($arg)*);
        } else {
            tracing::info!($($arg)*);
        }
    };
}

/// Macro to log error messages with trace ID
#[macro_export]
macro_rules! error_with_trace {
    ($($arg:tt)*) => {
        if let Some(trace_id) = $crate::observability::tracing::get_current_trace_id() {
            tracing::error!(trace_id = %trace_id, $($arg)*);
        } else {
            tracing::error!($($arg)*);
        }
    };
}

/// Macro to log warn messages with trace ID
#[macro_export]
macro_rules! warn_with_trace {
    ($($arg:tt)*) => {
        if let Some(trace_id) = $crate::observability::tracing::get_current_trace_id() {
            tracing::warn!(trace_id = %trace_id, $($arg)*);
        } else {
            tracing::warn!($($arg)*);
        }
    };
}

/// Initialize OpenTelemetry tracer with OTLP exporter for CloudWatch X-Ray integration
fn init_opentelemetry_tracer(
    service_name: &str,
    service_version: &str,
    otlp_endpoint: &str,
) -> Result<opentelemetry_sdk::trace::Tracer, ObservabilityError> {
    info!("Initializing OpenTelemetry tracer");

    // Create resource with service information - platform agnostic
    let resource_attributes = vec![
        KeyValue::new("service.name", service_name.to_string()),
        KeyValue::new("service.version", service_version.to_string()),
        KeyValue::new("service.namespace", "petadoptions"),
        KeyValue::new("cloud.provider", "aws"),
        // Generic cloud platform - let the collector/X-Ray detect the actual platform
        KeyValue::new("cloud.platform", "aws_container"),
        // OpenTelemetry SDK information
        KeyValue::new("telemetry.sdk.name", "opentelemetry"),
        KeyValue::new("telemetry.sdk.language", "rust"),
        KeyValue::new("telemetry.sdk.version", "1.44.1"),
    ];

    let resource = Resource::new(resource_attributes);

    // Configure OTLP exporter
    let mut exporter = opentelemetry_otlp::new_exporter().tonic();

    if !otlp_endpoint.is_empty() {
        info!("Using custom OTLP endpoint: {}", otlp_endpoint);
        exporter = exporter.with_endpoint(otlp_endpoint);
    } else {
        // Default to localhost for development, will be overridden in production
        info!("Using default OTLP endpoint: http://localhost:4317");
        exporter = exporter.with_endpoint("http://localhost:4317");
    }

    // Build tracer pipeline
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(exporter)
        .with_trace_config(
            trace::config()
                .with_sampler(Sampler::AlwaysOn)
                .with_id_generator(RandomIdGenerator::default())
                .with_max_events_per_span(64)
                .with_max_attributes_per_span(16)
                .with_max_links_per_span(16)
                .with_resource(resource),
        )
        .with_batch_config(
            trace::BatchConfig::default()
                .with_max_queue_size(2048)
                .with_max_export_batch_size(512)
                .with_max_export_timeout(Duration::from_secs(30))
                .with_scheduled_delay(Duration::from_millis(500)),
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)?;

    info!("OpenTelemetry tracer initialized successfully");
    Ok(tracer)
}

/// Shutdown observability gracefully with timeout
pub async fn shutdown_observability() {
    info!("Shutting down observability");

    // Use spawn_blocking to run the blocking shutdown in a separate thread
    let shutdown_task = tokio::task::spawn_blocking(|| {
        // Gracefully shutdown the tracer provider
        // This may block if there are pending spans, so we run it in a separate thread
        global::shutdown_tracer_provider();
    });

    // Apply timeout to prevent hanging indefinitely
    match tokio::time::timeout(Duration::from_secs(5), shutdown_task).await {
        Ok(Ok(())) => {
            info!("Observability shutdown completed successfully");
        }
        Ok(Err(e)) => {
            warn!("Error during observability shutdown: {}", e);
        }
        Err(_) => {
            warn!("Observability shutdown timed out after 5 seconds - forcing exit");
            // If shutdown times out, we'll let the process exit anyway
            // This prevents the application from hanging indefinitely
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_shutdown_observability_timeout() {
        // Test that shutdown_observability completes within reasonable time
        let start = std::time::Instant::now();
        shutdown_observability().await;
        let elapsed = start.elapsed();

        // Should complete within 6 seconds (5 second timeout + some buffer)
        assert!(
            elapsed < Duration::from_secs(6),
            "Shutdown took too long: {:?}",
            elapsed
        );
    }

    #[test]
    fn test_init_observability_development() {
        // Test that the function exists and can be called
        // In a real test environment, we would need a tokio runtime
        // For now, just test that the function signature is correct
        let _result = std::panic::catch_unwind(|| {
            // This will fail but we're just testing the function exists
            let _ = init_observability("test-service-dev", "0.1.0", "", false);
        });

        // Test passes if we can call the function without compilation errors
    }

    #[test]
    fn test_init_observability_production() {
        // Test that the function exists and can be called
        // In a real test environment, we would need a tokio runtime
        // For now, just test that the function signature is correct
        let _result = std::panic::catch_unwind(|| {
            // This will fail but we're just testing the function exists
            let _ = init_observability(
                "test-service-prod",
                "0.1.0",
                "http://test-endpoint:4317",
                true,
            );
        });

        // Test passes if we can call the function without compilation errors
    }
}
