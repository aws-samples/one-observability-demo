use opentelemetry::{
    global,
    metrics::{Counter, Histogram, UpDownCounter},
    KeyValue,
};
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum MetricsError {
    #[error("Failed to create metric: {0}")]
    Creation(String),
    #[error("Metrics error: {0}")]
    General(String),
}

/// Comprehensive metrics collection for the petfood service using OpenTelemetry
#[derive(Clone)]
pub struct Metrics {
    // HTTP metrics
    http_requests_total: Counter<u64>,
    http_request_duration_seconds: Histogram<f64>,
    http_requests_in_flight: UpDownCounter<i64>,

    // Database metrics
    database_operations_total: Counter<u64>,
    database_operation_duration_seconds: Histogram<f64>,

    // Business logic metrics
    food_operations_total: Counter<u64>,
    cart_operations_total: Counter<u64>,
    recommendation_requests_total: Counter<u64>,

    // Error simulation metrics
    error_simulation_triggers_total: Counter<u64>,
}

impl Metrics {
    /// Create a new metrics instance using the global OTel MeterProvider
    pub fn new() -> Result<Self, MetricsError> {
        info!("Initializing OpenTelemetry metrics");

        let meter = global::meter("petfood-rs");

        // HTTP metrics
        let http_requests_total = meter
            .u64_counter("http.server.request.total")
            .with_description("Total number of HTTP requests processed")
            .init();

        let http_request_duration_seconds = meter
            .f64_histogram("http.server.request.duration")
            .with_description("HTTP request duration in seconds")
            .with_unit(opentelemetry::metrics::Unit::new("s"))
            .init();

        let http_requests_in_flight = meter
            .i64_up_down_counter("http.server.active_requests")
            .with_description("Number of HTTP requests currently being processed")
            .init();

        // Database metrics
        let database_operations_total = meter
            .u64_counter("db.client.operation.total")
            .with_description("Total number of database operations")
            .init();

        let database_operation_duration_seconds = meter
            .f64_histogram("db.client.operation.duration")
            .with_description("Database operation duration in seconds")
            .with_unit(opentelemetry::metrics::Unit::new("s"))
            .init();

        // Business logic metrics
        let food_operations_total = meter
            .u64_counter("petfood.food.operation.total")
            .with_description("Total number of food-related operations")
            .init();

        let cart_operations_total = meter
            .u64_counter("petfood.cart.operation.total")
            .with_description("Total number of cart operations")
            .init();

        let recommendation_requests_total = meter
            .u64_counter("petfood.recommendation.request.total")
            .with_description("Total number of recommendation requests")
            .init();

        // Error simulation metrics
        let error_simulation_triggers_total = meter
            .u64_counter("petfood.error_simulation.trigger.total")
            .with_description("Total number of error simulation triggers")
            .init();

        info!("OpenTelemetry metrics initialized successfully");

        Ok(Metrics {
            http_requests_total,
            http_request_duration_seconds,
            http_requests_in_flight,
            database_operations_total,
            database_operation_duration_seconds,
            food_operations_total,
            cart_operations_total,
            recommendation_requests_total,
            error_simulation_triggers_total,
        })
    }

    /// Record HTTP request metrics
    pub fn record_http_request(
        &self,
        method: &str,
        endpoint: &str,
        status_code: u16,
        duration_seconds: f64,
    ) {
        let attributes = [
            KeyValue::new("http.request.method", method.to_string()),
            KeyValue::new("http.route", endpoint.to_string()),
            KeyValue::new("http.response.status_code", status_code as i64),
        ];

        self.http_requests_total.add(1, &attributes);
        self.http_request_duration_seconds
            .record(duration_seconds, &attributes[..2]);
    }

    /// Record database operation metrics
    pub fn record_database_operation(
        &self,
        operation: &str,
        table: &str,
        success: bool,
        duration_seconds: f64,
    ) {
        let status = if success { "success" } else { "error" };
        let attributes = [
            KeyValue::new("db.operation", operation.to_string()),
            KeyValue::new("db.collection.name", table.to_string()),
            KeyValue::new("status", status.to_string()),
        ];

        self.database_operations_total.add(1, &attributes);
        self.database_operation_duration_seconds
            .record(duration_seconds, &attributes[..2]);
    }

    /// Record food operation metrics
    pub fn record_food_operation(
        &self,
        operation: &str,
        pet_type: Option<&str>,
        food_type: Option<&str>,
        success: bool,
    ) {
        let status = if success { "success" } else { "error" };
        let attributes = [
            KeyValue::new("operation", operation.to_string()),
            KeyValue::new("pet_type", pet_type.unwrap_or("unknown").to_string()),
            KeyValue::new("food_type", food_type.unwrap_or("unknown").to_string()),
            KeyValue::new("status", status.to_string()),
        ];

        self.food_operations_total.add(1, &attributes);
    }

    /// Record cart operation metrics
    pub fn record_cart_operation(&self, operation: &str, success: bool) {
        let status = if success { "success" } else { "error" };
        let attributes = [
            KeyValue::new("operation", operation.to_string()),
            KeyValue::new("status", status.to_string()),
        ];

        self.cart_operations_total.add(1, &attributes);
    }

    /// Record recommendation request metrics
    pub fn record_recommendation_request(&self, pet_type: &str, success: bool) {
        let status = if success { "success" } else { "error" };
        let attributes = [
            KeyValue::new("pet_type", pet_type.to_string()),
            KeyValue::new("status", status.to_string()),
        ];

        self.recommendation_requests_total.add(1, &attributes);
    }

    /// Record error simulation trigger
    pub fn record_error_simulation(&self, scenario: &str, trigger_type: &str) {
        let attributes = [
            KeyValue::new("scenario", scenario.to_string()),
            KeyValue::new("trigger_type", trigger_type.to_string()),
        ];

        self.error_simulation_triggers_total.add(1, &attributes);
    }

    /// Update system metrics (memory and CPU usage)
    /// Note: With OTel, system metrics are typically collected by the collector itself
    /// via host metrics receiver. We keep the method signature for compatibility but
    /// these are now observable via the OTel collector's hostmetrics receiver.
    pub fn update_system_metrics(&self, _memory_bytes: f64, _cpu_percent: f64) {
        // System-level metrics (memory, CPU) are best handled by the OTel Collector's
        // hostmetrics receiver rather than application-level instrumentation.
        // This is a no-op to maintain API compatibility.
    }

    /// Increment in-flight requests
    pub fn increment_in_flight(&self, method: &str, endpoint: &str) {
        let attributes = [
            KeyValue::new("http.request.method", method.to_string()),
            KeyValue::new("http.route", endpoint.to_string()),
        ];
        self.http_requests_in_flight.add(1, &attributes);
    }

    /// Decrement in-flight requests
    pub fn decrement_in_flight(&self, method: &str, endpoint: &str) {
        let attributes = [
            KeyValue::new("http.request.method", method.to_string()),
            KeyValue::new("http.route", endpoint.to_string()),
        ];
        self.http_requests_in_flight.add(-1, &attributes);
    }

    /// Set active database connections
    /// Note: OTel UpDownCounter doesn't support "set" semantics.
    /// In production, use an ObservableGauge with a callback for absolute values.
    pub fn set_active_connections(&self, _count: f64) {
        // No-op: absolute gauge values require ObservableGauge with callbacks.
        // The OTel Collector's receiver/hostmetrics can observe connection pools directly.
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new().expect("Failed to create default metrics")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_creation() {
        let metrics = Metrics::new();
        assert!(metrics.is_ok());
    }

    #[test]
    fn test_http_request_recording() {
        let metrics = Metrics::new().unwrap();
        // These should not panic
        metrics.record_http_request("GET", "/api/foods", 200, 0.123);
        metrics.record_http_request("POST", "/api/foods", 201, 0.456);
    }

    #[test]
    fn test_database_operation_recording() {
        let metrics = Metrics::new().unwrap();
        metrics.record_database_operation("get_item", "PetFoods", true, 0.050);
        metrics.record_database_operation("put_item", "PetFoodCarts", false, 0.100);
    }

    #[test]
    fn test_business_metrics_recording() {
        let metrics = Metrics::new().unwrap();
        metrics.record_food_operation("search", Some("puppy"), Some("dry"), true);
        metrics.record_cart_operation("add_item", true);
        metrics.record_recommendation_request("kitten", true);
    }

    #[test]
    fn test_in_flight_requests() {
        let metrics = Metrics::new().unwrap();
        metrics.increment_in_flight("GET", "/api/foods");
        metrics.increment_in_flight("GET", "/api/foods");
        metrics.decrement_in_flight("GET", "/api/foods");
    }
}
