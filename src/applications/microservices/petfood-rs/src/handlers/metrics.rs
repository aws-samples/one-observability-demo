use axum::{
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
};
use prometheus::{Encoder, Registry, TextEncoder};
use std::sync::Arc;

/// Content type for Prometheus text exposition format.
const PROMETHEUS_CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";

/// Prometheus metrics scrape endpoint.
///
/// Serves all OTel SDK metrics in Prometheus text exposition format.
/// This enables dual-export: metrics are pushed via OTLP to the CW Agent
/// sidecar AND scraped by Prometheus-compatible collectors (CW Agent
/// Prometheus receiver, Amazon Managed Prometheus Collector, etc.).
pub async fn metrics_handler(State(registry): State<Arc<Registry>>) -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = registry.gather();
    let mut buffer = Vec::new();

    match encoder.encode(&metric_families, &mut buffer) {
        Ok(()) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, PROMETHEUS_CONTENT_TYPE)],
            buffer,
        ),
        Err(e) => {
            let error_msg = format!("Failed to encode metrics: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                error_msg.into_bytes(),
            )
        }
    }
}
