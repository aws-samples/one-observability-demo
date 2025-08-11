use prometheus::{
    CounterVec, Encoder, Gauge, GaugeVec, HistogramOpts, HistogramVec, Opts,
    Registry, TextEncoder,
};
use thiserror::Error;
use tracing::{error, info};

#[derive(Debug, Error)]
pub enum MetricsError {
    #[error("Failed to register metric: {0}")]
    Registration(#[from] prometheus::Error),
    #[error("Failed to encode metrics: {0}")]
    Encoding(String),
    #[error("Metric not found: {0}")]
    NotFound(String),
}

/// Comprehensive metrics collection for the petfood service
#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    
    // HTTP metrics
    pub http_requests_total: CounterVec,
    pub http_request_duration_seconds: HistogramVec,
    pub http_requests_in_flight: GaugeVec,
    
    // Database metrics
    pub database_operations_total: CounterVec,
    pub database_operation_duration_seconds: HistogramVec,
    pub database_connections_active: Gauge,
    
    // Business logic metrics
    pub food_operations_total: CounterVec,
    pub cart_operations_total: CounterVec,
    pub recommendation_requests_total: CounterVec,
    
    // System metrics
    pub memory_usage_bytes: Gauge,
    pub cpu_usage_percent: Gauge,
    
    // Error simulation metrics
    pub error_simulation_triggers_total: CounterVec,
}

impl Metrics {
    /// Create a new metrics instance with all required metrics registered
    pub fn new() -> Result<Self, MetricsError> {
        let registry = Registry::new();
        
        info!("Initializing Prometheus metrics");

        // HTTP metrics
        let http_requests_total = CounterVec::new(
            Opts::new(
                "http_requests_total",
                "Total number of HTTP requests processed"
            ),
            &["method", "endpoint", "status_code"]
        )?;

        let http_request_duration_seconds = HistogramVec::new(
            HistogramOpts::new(
                "http_request_duration_seconds",
                "HTTP request duration in seconds"
            ).buckets(vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]),
            &["method", "endpoint"]
        )?;

        let http_requests_in_flight = GaugeVec::new(
            Opts::new(
                "http_requests_in_flight",
                "Number of HTTP requests currently being processed"
            ),
            &["method", "endpoint"]
        )?;

        // Database metrics
        let database_operations_total = CounterVec::new(
            Opts::new(
                "database_operations_total",
                "Total number of database operations"
            ),
            &["operation", "table", "status"]
        )?;

        let database_operation_duration_seconds = HistogramVec::new(
            HistogramOpts::new(
                "database_operation_duration_seconds",
                "Database operation duration in seconds"
            ).buckets(vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]),
            &["operation", "table"]
        )?;

        let database_connections_active = Gauge::new(
            "database_connections_active",
            "Number of active database connections"
        )?;

        // Business logic metrics
        let food_operations_total = CounterVec::new(
            Opts::new(
                "food_operations_total",
                "Total number of food-related operations"
            ),
            &["operation", "pet_type", "food_type", "status"]
        )?;

        let cart_operations_total = CounterVec::new(
            Opts::new(
                "cart_operations_total",
                "Total number of cart operations"
            ),
            &["operation", "status"]
        )?;

        let recommendation_requests_total = CounterVec::new(
            Opts::new(
                "recommendation_requests_total",
                "Total number of recommendation requests"
            ),
            &["pet_type", "status"]
        )?;

        // System metrics
        let memory_usage_bytes = Gauge::new(
            "memory_usage_bytes",
            "Current memory usage in bytes"
        )?;

        let cpu_usage_percent = Gauge::new(
            "cpu_usage_percent",
            "Current CPU usage percentage"
        )?;

        // Error simulation metrics
        let error_simulation_triggers_total = CounterVec::new(
            Opts::new(
                "error_simulation_triggers_total",
                "Total number of error simulation triggers"
            ),
            &["scenario", "trigger_type"]
        )?;

        // Register all metrics
        registry.register(Box::new(http_requests_total.clone()))?;
        registry.register(Box::new(http_request_duration_seconds.clone()))?;
        registry.register(Box::new(http_requests_in_flight.clone()))?;
        registry.register(Box::new(database_operations_total.clone()))?;
        registry.register(Box::new(database_operation_duration_seconds.clone()))?;
        registry.register(Box::new(database_connections_active.clone()))?;
        registry.register(Box::new(food_operations_total.clone()))?;
        registry.register(Box::new(cart_operations_total.clone()))?;
        registry.register(Box::new(recommendation_requests_total.clone()))?;
        registry.register(Box::new(memory_usage_bytes.clone()))?;
        registry.register(Box::new(cpu_usage_percent.clone()))?;
        registry.register(Box::new(error_simulation_triggers_total.clone()))?;

        info!("Prometheus metrics initialized successfully");

        Ok(Metrics {
            registry,
            http_requests_total,
            http_request_duration_seconds,
            http_requests_in_flight,
            database_operations_total,
            database_operation_duration_seconds,
            database_connections_active,
            food_operations_total,
            cart_operations_total,
            recommendation_requests_total,
            memory_usage_bytes,
            cpu_usage_percent,
            error_simulation_triggers_total,
        })
    }

    /// Get the metrics registry for exposing metrics endpoint
    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    /// Encode all metrics in Prometheus text format
    pub fn encode(&self) -> Result<String, MetricsError> {
        let encoder = TextEncoder::new();
        let metric_families = self.registry.gather();
        
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer)
            .map_err(|e| MetricsError::Encoding(e.to_string()))?;
        
        String::from_utf8(buffer)
            .map_err(|e| MetricsError::Encoding(e.to_string()))
    }

    /// Record HTTP request metrics
    pub fn record_http_request(
        &self,
        method: &str,
        endpoint: &str,
        status_code: u16,
        duration_seconds: f64,
    ) {
        let status_str = status_code.to_string();
        
        self.http_requests_total
            .with_label_values(&[method, endpoint, &status_str])
            .inc();
            
        self.http_request_duration_seconds
            .with_label_values(&[method, endpoint])
            .observe(duration_seconds);
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
        
        self.database_operations_total
            .with_label_values(&[operation, table, status])
            .inc();
            
        self.database_operation_duration_seconds
            .with_label_values(&[operation, table])
            .observe(duration_seconds);
    }

    /// Record food operation metrics
    pub fn record_food_operation(
        &self,
        operation: &str,
        pet_type: Option<&str>,
        food_type: Option<&str>,
        success: bool,
    ) {
        let pet_type_str = pet_type.unwrap_or("unknown");
        let food_type_str = food_type.unwrap_or("unknown");
        let status = if success { "success" } else { "error" };
        
        self.food_operations_total
            .with_label_values(&[operation, pet_type_str, food_type_str, status])
            .inc();
    }

    /// Record cart operation metrics
    pub fn record_cart_operation(&self, operation: &str, success: bool) {
        let status = if success { "success" } else { "error" };
        
        self.cart_operations_total
            .with_label_values(&[operation, status])
            .inc();
    }

    /// Record recommendation request metrics
    pub fn record_recommendation_request(&self, pet_type: &str, success: bool) {
        let status = if success { "success" } else { "error" };
        
        self.recommendation_requests_total
            .with_label_values(&[pet_type, status])
            .inc();
    }

    /// Record error simulation trigger
    pub fn record_error_simulation(&self, scenario: &str, trigger_type: &str) {
        self.error_simulation_triggers_total
            .with_label_values(&[scenario, trigger_type])
            .inc();
    }

    /// Update system metrics (memory and CPU usage)
    pub fn update_system_metrics(&self, memory_bytes: f64, cpu_percent: f64) {
        self.memory_usage_bytes.set(memory_bytes);
        self.cpu_usage_percent.set(cpu_percent);
    }

    /// Increment in-flight requests
    pub fn increment_in_flight(&self, method: &str, endpoint: &str) {
        self.http_requests_in_flight
            .with_label_values(&[method, endpoint])
            .inc();
    }

    /// Decrement in-flight requests
    pub fn decrement_in_flight(&self, method: &str, endpoint: &str) {
        self.http_requests_in_flight
            .with_label_values(&[method, endpoint])
            .dec();
    }

    /// Set active database connections
    pub fn set_active_connections(&self, count: f64) {
        self.database_connections_active.set(count);
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
        
        metrics.record_http_request("GET", "/api/foods", 200, 0.123);
        metrics.record_http_request("POST", "/api/foods", 201, 0.456);
        
        // Verify metrics can be encoded
        let encoded = metrics.encode();
        assert!(encoded.is_ok());
        
        let metrics_text = encoded.unwrap();
        assert!(metrics_text.contains("http_requests_total"));
        assert!(metrics_text.contains("http_request_duration_seconds"));
    }

    #[test]
    fn test_database_operation_recording() {
        let metrics = Metrics::new().unwrap();
        
        metrics.record_database_operation("get_item", "PetFoods", true, 0.050);
        metrics.record_database_operation("put_item", "PetFoodCarts", false, 0.100);
        
        let encoded = metrics.encode().unwrap();
        assert!(encoded.contains("database_operations_total"));
        assert!(encoded.contains("database_operation_duration_seconds"));
    }

    #[test]
    fn test_business_metrics_recording() {
        let metrics = Metrics::new().unwrap();
        
        metrics.record_food_operation("search", Some("puppy"), Some("dry"), true);
        metrics.record_cart_operation("add_item", true);
        metrics.record_recommendation_request("kitten", true);
        
        let encoded = metrics.encode().unwrap();
        assert!(encoded.contains("food_operations_total"));
        assert!(encoded.contains("cart_operations_total"));
        assert!(encoded.contains("recommendation_requests_total"));
    }

    #[test]
    fn test_in_flight_requests() {
        let metrics = Metrics::new().unwrap();
        
        metrics.increment_in_flight("GET", "/api/foods");
        metrics.increment_in_flight("GET", "/api/foods");
        metrics.decrement_in_flight("GET", "/api/foods");
        
        let encoded = metrics.encode().unwrap();
        assert!(encoded.contains("http_requests_in_flight"));
    }
}