use std::time::Duration;

use axum::{
    response::Json,
    routing::{get, post},
    Router,
};
use reqwest::Client;
use serde_json::json;
use tokio::net::TcpListener;

pub struct TestEnvironment {
    pub client: Client,
    pub base_url: String,
}

// Mock handlers for testing
async fn mock_health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "petfood-test",
        "version": "0.1.0"
    }))
}

async fn mock_list_foods() -> Json<serde_json::Value> {
    Json(json!({
        "foods": [],
        "total_count": 0
    }))
}

async fn mock_admin_seed() -> Json<serde_json::Value> {
    Json(json!({
        "message": "Database seeded successfully",
        "foods_created": 3
    }))
}

async fn mock_admin_cleanup() -> Json<serde_json::Value> {
    Json(json!({
        "message": "Database cleaned up successfully",
        "foods_deleted": 3
    }))
}

fn create_mock_app() -> Router {
    Router::new()
        .route("/health/status", get(mock_health))
        .route("/api/foods", get(mock_list_foods))
        .route("/api/admin/seed", post(mock_admin_seed))
        .route("/api/admin/cleanup", post(mock_admin_cleanup))
}

impl TestEnvironment {
    pub async fn new() -> Self {
        // Create a simple mock app for testing
        let app = create_mock_app();

        // Start server
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("Failed to bind listener");
        let addr = listener.local_addr().expect("Failed to get local address");
        let base_url = format!("http://{}", addr);

        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("Failed to serve app");
        });

        // Wait for server to start
        tokio::time::sleep(Duration::from_millis(100)).await;

        let client = Client::new();

        Self { client, base_url }
    }

    pub async fn seed_test_data(&self) {
        // For mock testing, just call the seed endpoint
        let response = self
            .client
            .post(&format!("{}/api/admin/seed", self.base_url))
            .send()
            .await
            .expect("Failed to seed test data");

        // Use numeric status codes to avoid the StatusCode comparison issue
        assert_eq!(response.status().as_u16(), 200);
    }
}
