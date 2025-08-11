use axum::{
    middleware,
    routing::get,
    Router,
};
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tracing::info;

use petfood_rs::{
    handlers::{health_check, metrics_handler},
    observability::{observability_middleware, Metrics},
    Config, init_observability, shutdown_observability,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load configuration first (basic logging only)
    let config = Config::from_environment().await?;
    println!("Configuration loaded successfully");

    // Initialize comprehensive observability
    init_observability(
        &config.observability.service_name,
        &config.observability.service_version,
        config.observability.otlp_endpoint.as_deref(),
        config.observability.enable_json_logging,
    )?;

    info!("Starting petfood-rs service");
    info!("Service: {} v{}", config.observability.service_name, config.observability.service_version);
    info!("Region: {}", config.aws.region);
    info!("DynamoDB Tables: foods={}, carts={}", 
          config.database.foods_table_name, 
          config.database.carts_table_name);

    // Initialize metrics
    let metrics = Arc::new(Metrics::new()?);
    info!("Metrics initialized successfully");

    // Build the application router
    let app = create_app(metrics);

    // Create socket address
    let addr = SocketAddr::new(
        config.server.host.parse()?,
        config.server.port,
    );

    info!("Server listening on {}", addr);

    // Create TCP listener
    let listener = TcpListener::bind(addr).await?;

    // Set up graceful shutdown
    let shutdown_signal = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install CTRL+C signal handler");
        info!("Shutdown signal received");
        shutdown_observability();
    };

    // Start the server with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await?;

    info!("Server shutdown complete");
    Ok(())
}

fn create_app(metrics: Arc<Metrics>) -> Router {
    let metrics_for_middleware = metrics.clone();
    
    Router::new()
        .route("/health/status", get(health_check))
        .route("/metrics", get(metrics_handler))
        .layer(middleware::from_fn(move |req, next| {
            observability_middleware(metrics_for_middleware.clone(), req, next)
        }))
        .with_state(metrics)
}

