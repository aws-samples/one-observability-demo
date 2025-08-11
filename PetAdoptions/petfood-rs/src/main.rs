use axum::{
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use petfood_rs::{handlers::health_check, Config};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize basic tracing first
    if let Err(e) = init_basic_tracing() {
        eprintln!("Failed to initialize tracing: {}", e);
        return Err(e);
    }

    // Load configuration
    let config = match Config::from_environment().await {
        Ok(config) => {
            info!("Configuration loaded successfully");
            config
        }
        Err(e) => {
            error!("Failed to load configuration: {}", e);
            return Err(Box::new(e));
        }
    };

    info!("Starting petfood-rs service");
    info!("Service: {} v{}", config.observability.service_name, config.observability.service_version);
    info!("Region: {}", config.aws.region);
    info!("DynamoDB Tables: foods={}, carts={}", 
          config.database.foods_table_name, 
          config.database.carts_table_name);

    // Build the application router
    let app = create_app();

    // Create socket address
    let addr = SocketAddr::new(
        config.server.host.parse().map_err(|e| {
            error!("Failed to parse host address: {}", e);
            Box::new(e) as Box<dyn std::error::Error>
        })?,
        config.server.port,
    );

    info!("Server listening on {}", addr);

    // Create TCP listener
    let listener = TcpListener::bind(addr).await.map_err(|e| {
        error!("Failed to bind to address: {}", e);
        Box::new(e) as Box<dyn std::error::Error>
    })?;

    // Start the server
    axum::serve(listener, app).await.map_err(|e| {
        error!("Server error: {}", e);
        Box::new(e) as Box<dyn std::error::Error>
    })?;

    Ok(())
}

fn create_app() -> Router {
    Router::new()
        .route("/health/status", get(health_check))
        .layer(TraceLayer::new_for_http())
}

fn init_basic_tracing() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "petfood_rs=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();

    Ok(())
}