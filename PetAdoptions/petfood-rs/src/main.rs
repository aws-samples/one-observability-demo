use axum::{
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use petfood_rs::{handlers::health_check, Config};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    init_tracing()?;

    // Load configuration
    let config = Config::from_env().unwrap_or_else(|_| {
        info!("Using default configuration");
        Config {
            server: petfood_rs::config::ServerConfig {
                host: "0.0.0.0".to_string(),
                port: 80,
                request_timeout_seconds: 30,
            },
        }
    });

    info!("Starting petfood-rs service");
    info!("Configuration: {:?}", config);

    // Build the application router
    let app = create_app();

    // Create socket address
    let addr = SocketAddr::new(
        config.server.host.parse()?,
        config.server.port,
    );

    info!("Server listening on {}", addr);

    // Create TCP listener
    let listener = TcpListener::bind(addr).await?;

    // Start the server
    axum::serve(listener, app).await?;

    Ok(())
}

fn create_app() -> Router {
    Router::new()
        .route("/health/status", get(health_check))
        .layer(TraceLayer::new_for_http())
}

fn init_tracing() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "petfood_rs=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    Ok(())
}