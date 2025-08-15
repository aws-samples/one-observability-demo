use axum::{http::StatusCode, response::Json};
use serde_json::{json, Value};

/// Health check endpoint handler
pub async fn health_check() -> Result<Json<Value>, StatusCode> {
    Ok(Json(json!({
        "status": "healthy",
        "service": "petfood-rs",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": chrono::Utc::now().to_rfc3339()
    })))
}
