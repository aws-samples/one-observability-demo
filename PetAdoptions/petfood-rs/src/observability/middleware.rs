use axum::{
    extract::{MatchedPath, Request},
    middleware::Next,
    response::Response,
};
use std::{sync::Arc, time::Instant};
use tracing::{error, info, instrument, Span};
use uuid::Uuid;

use super::Metrics;

/// Middleware for automatic request tracing and metrics collection
#[instrument(skip_all, fields(
    request_id = %Uuid::new_v4(),
    method = %request.method(),
    uri = %request.uri(),
))]
pub async fn observability_middleware(
    metrics: Arc<Metrics>,
    request: Request,
    next: Next,
) -> Response {
    let start_time = Instant::now();
    let method = request.method().to_string();
    let uri = request.uri().to_string();
    
    // Try to get the matched path for better endpoint grouping
    let endpoint = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched_path| matched_path.as_str().to_string())
        .unwrap_or_else(|| uri.clone());

    // Add request information to the current span
    let current_span = Span::current();
    current_span.record("endpoint", &endpoint);

    // Increment in-flight requests
    metrics.increment_in_flight(&method, &endpoint);

    info!("Processing request");

    // Process the request
    let response = next.run(request).await;
    
    // Calculate duration
    let duration = start_time.elapsed();
    let duration_seconds = duration.as_secs_f64();
    
    // Get status code
    let status_code = response.status().as_u16();
    
    // Record metrics
    metrics.record_http_request(&method, &endpoint, status_code, duration_seconds);
    
    // Decrement in-flight requests
    metrics.decrement_in_flight(&method, &endpoint);

    // Log request completion
    if status_code >= 400 {
        error!(
            status_code = status_code,
            duration_ms = duration.as_millis(),
            "Request completed with error"
        );
    } else {
        info!(
            status_code = status_code,
            duration_ms = duration.as_millis(),
            "Request completed successfully"
        );
    }

    response
}

/// Middleware specifically for database operation tracing
pub struct DatabaseTracingMiddleware {
    metrics: Arc<Metrics>,
}

impl DatabaseTracingMiddleware {
    pub fn new(metrics: Arc<Metrics>) -> Self {
        Self { metrics }
    }

    /// Trace a database operation with automatic metrics recording
    #[instrument(skip_all, fields(
        operation = %operation,
        table = %table,
    ))]
    pub async fn trace_operation<F, T, E>(
        &self,
        operation: &str,
        table: &str,
        future: F,
    ) -> Result<T, E>
    where
        F: std::future::Future<Output = Result<T, E>>,
        E: std::fmt::Display,
    {
        let start_time = Instant::now();
        
        info!("Starting database operation");
        
        match future.await {
            Ok(result) => {
                let duration_seconds = start_time.elapsed().as_secs_f64();
                self.metrics.record_database_operation(operation, table, true, duration_seconds);
                
                info!(
                    duration_ms = start_time.elapsed().as_millis(),
                    "Database operation completed successfully"
                );
                
                Ok(result)
            }
            Err(error) => {
                let duration_seconds = start_time.elapsed().as_secs_f64();
                self.metrics.record_database_operation(operation, table, false, duration_seconds);
                
                error!(
                    error = %error,
                    duration_ms = start_time.elapsed().as_millis(),
                    "Database operation failed"
                );
                
                Err(error)
            }
        }
    }
}

/// Middleware for business operation tracing
pub struct BusinessTracingMiddleware {
    metrics: Arc<Metrics>,
}

impl BusinessTracingMiddleware {
    pub fn new(metrics: Arc<Metrics>) -> Self {
        Self { metrics }
    }

    /// Trace a food operation
    #[instrument(skip_all, fields(
        operation = %operation,
        pet_type = pet_type,
        food_type = food_type,
    ))]
    pub async fn trace_food_operation<F, T, E>(
        &self,
        operation: &str,
        pet_type: Option<&str>,
        food_type: Option<&str>,
        future: F,
    ) -> Result<T, E>
    where
        F: std::future::Future<Output = Result<T, E>>,
        E: std::fmt::Display,
    {
        let start_time = Instant::now();
        
        info!("Starting food operation");
        
        match future.await {
            Ok(result) => {
                self.metrics.record_food_operation(operation, pet_type, food_type, true);
                
                info!(
                    duration_ms = start_time.elapsed().as_millis(),
                    "Food operation completed successfully"
                );
                
                Ok(result)
            }
            Err(error) => {
                self.metrics.record_food_operation(operation, pet_type, food_type, false);
                
                error!(
                    error = %error,
                    duration_ms = start_time.elapsed().as_millis(),
                    "Food operation failed"
                );
                
                Err(error)
            }
        }
    }

    /// Trace a cart operation
    #[instrument(skip_all, fields(
        operation = %operation,
        user_id = user_id,
    ))]
    pub async fn trace_cart_operation<F, T, E>(
        &self,
        operation: &str,
        user_id: Option<&str>,
        future: F,
    ) -> Result<T, E>
    where
        F: std::future::Future<Output = Result<T, E>>,
        E: std::fmt::Display,
    {
        let start_time = Instant::now();
        
        info!("Starting cart operation");
        
        match future.await {
            Ok(result) => {
                self.metrics.record_cart_operation(operation, true);
                
                info!(
                    duration_ms = start_time.elapsed().as_millis(),
                    "Cart operation completed successfully"
                );
                
                Ok(result)
            }
            Err(error) => {
                self.metrics.record_cart_operation(operation, false);
                
                error!(
                    error = %error,
                    duration_ms = start_time.elapsed().as_millis(),
                    "Cart operation failed"
                );
                
                Err(error)
            }
        }
    }

    /// Trace a recommendation request
    #[instrument(skip_all, fields(
        pet_type = %pet_type,
    ))]
    pub async fn trace_recommendation_request<F, T, E>(
        &self,
        pet_type: &str,
        future: F,
    ) -> Result<T, E>
    where
        F: std::future::Future<Output = Result<T, E>>,
        E: std::fmt::Display,
    {
        let start_time = Instant::now();
        
        info!("Starting recommendation request");
        
        match future.await {
            Ok(result) => {
                self.metrics.record_recommendation_request(pet_type, true);
                
                info!(
                    duration_ms = start_time.elapsed().as_millis(),
                    "Recommendation request completed successfully"
                );
                
                Ok(result)
            }
            Err(error) => {
                self.metrics.record_recommendation_request(pet_type, false);
                
                error!(
                    error = %error,
                    duration_ms = start_time.elapsed().as_millis(),
                    "Recommendation request failed"
                );
                
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
        middleware,
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    async fn test_handler() -> &'static str {
        "test response"
    }

    async fn error_handler() -> StatusCode {
        StatusCode::INTERNAL_SERVER_ERROR
    }

    #[tokio::test]
    async fn test_observability_middleware_success() {
        let metrics = Arc::new(Metrics::new().unwrap());
        let metrics_clone = metrics.clone();

        let app = Router::new()
            .route("/test", get(test_handler))
            .layer(middleware::from_fn(move |req, next| {
                observability_middleware(metrics_clone.clone(), req, next)
            }));

        let request = Request::builder()
            .method(Method::GET)
            .uri("/test")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Verify metrics were recorded
        let encoded = metrics.encode().unwrap();
        assert!(encoded.contains("http_requests_total"));
    }

    #[tokio::test]
    async fn test_observability_middleware_error() {
        let metrics = Arc::new(Metrics::new().unwrap());
        let metrics_clone = metrics.clone();

        let app = Router::new()
            .route("/error", get(error_handler))
            .layer(middleware::from_fn(move |req, next| {
                observability_middleware(metrics_clone.clone(), req, next)
            }));

        let request = Request::builder()
            .method(Method::GET)
            .uri("/error")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        // Verify error metrics were recorded
        let encoded = metrics.encode().unwrap();
        assert!(encoded.contains("http_requests_total"));
    }

    #[tokio::test]
    async fn test_database_tracing_middleware() {
        let metrics = Arc::new(Metrics::new().unwrap());
        let middleware = DatabaseTracingMiddleware::new(metrics.clone());

        // Test successful operation
        let result = middleware
            .trace_operation("get_item", "test_table", async { Ok::<_, String>("success") })
            .await;
        
        assert!(result.is_ok());

        // Test failed operation
        let result = middleware
            .trace_operation("put_item", "test_table", async { Err::<String, _>("error") })
            .await;
        
        assert!(result.is_err());

        // Verify metrics were recorded
        let encoded = metrics.encode().unwrap();
        assert!(encoded.contains("database_operations_total"));
    }

    #[tokio::test]
    async fn test_business_tracing_middleware() {
        let metrics = Arc::new(Metrics::new().unwrap());
        let middleware = BusinessTracingMiddleware::new(metrics.clone());

        // Test food operation
        let result = middleware
            .trace_food_operation(
                "search",
                Some("puppy"),
                Some("dry"),
                async { Ok::<_, String>("success") }
            )
            .await;
        
        assert!(result.is_ok());

        // Test cart operation
        let result = middleware
            .trace_cart_operation(
                "add_item",
                Some("user123"),
                async { Ok::<_, String>("success") }
            )
            .await;
        
        assert!(result.is_ok());

        // Test recommendation request
        let result = middleware
            .trace_recommendation_request(
                "kitten",
                async { Ok::<_, String>("success") }
            )
            .await;
        
        assert!(result.is_ok());

        // Verify metrics were recorded
        let encoded = metrics.encode().unwrap();
        assert!(encoded.contains("food_operations_total"));
        assert!(encoded.contains("cart_operations_total"));
        assert!(encoded.contains("recommendation_requests_total"));
    }
}