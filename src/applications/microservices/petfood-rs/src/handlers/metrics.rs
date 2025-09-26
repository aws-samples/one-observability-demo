use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use tracing::{error, instrument};

use crate::observability::Metrics;

/// Handler for Prometheus metrics endpoint
#[instrument(name = "metrics_handler", skip(metrics))]
pub async fn metrics_handler(State(metrics): State<Arc<Metrics>>) -> Response {
    match metrics.encode() {
        Ok(metrics_text) => (
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                "text/plain; version=0.0.4; charset=utf-8",
            )],
            metrics_text,
        )
            .into_response(),
        Err(e) => {
            error!(error = %e, "Failed to encode metrics");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to encode metrics",
            )
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_metrics_handler() {
        let metrics = Arc::new(Metrics::new().unwrap());

        // Record some test metrics
        metrics.record_http_request("GET", "/test", 200, 0.123);
        metrics.record_database_operation("get_item", "test_table", true, 0.050);

        let app = Router::new()
            .route("/metrics", get(metrics_handler))
            .with_state(metrics);

        let request = Request::builder()
            .uri("/metrics")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let content_type = response.headers().get("content-type").unwrap();
        assert_eq!(content_type, "text/plain; version=0.0.4; charset=utf-8");

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        // Verify metrics are present
        assert!(body_str.contains("http_requests_total"));
        assert!(body_str.contains("database_operations_total"));
    }
}
