use axum::{
    middleware,
    routing::{get, post, put},
    Router,
};
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tracing::{info, warn};

use petfood_rs::{
    handlers::{
        admin, api, cors_middleware, health_check, metrics_handler, request_validation_middleware,
        security_headers_middleware,
    },
    init_observability,
    models::EventConfig,
    observability::{observability_middleware, Metrics},
    repositories::{DynamoDbCartRepository, DynamoDbFoodRepository, TableManager},
    services::{CartService, EventEmitter, FoodService},
    shutdown_observability, Config,
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
        &config.observability.otlp_endpoint,
        config.observability.enable_json_logging,
    )?;

    info!("Starting petfood-rs service");
    info!(
        "Service: {} v{}",
        config.observability.service_name, config.observability.service_version
    );
    info!("Region: {}", config.aws.region);
    info!(
        "DynamoDB Tables: foods={}, carts={}",
        config.database.foods_table_name, config.database.carts_table_name
    );

    // Initialize metrics
    let metrics = Arc::new(Metrics::new()?);
    info!("Metrics initialized successfully");

    // Use AWS clients from config (already properly configured with region and credentials)
    let dynamodb_client = Arc::new(config.aws.dynamodb_client.clone());
    info!("AWS clients initialized successfully");

    // Initialize table manager
    let table_manager = Arc::new(TableManager::new(dynamodb_client.clone()));
    info!("Table manager initialized successfully");

    // Initialize repositories
    let food_repository = Arc::new(DynamoDbFoodRepository::new(
        dynamodb_client.clone(),
        config.database.foods_table_name.clone(),
        config.database.region.clone(),
    ));
    let cart_repository = Arc::new(DynamoDbCartRepository::new(
        dynamodb_client.clone(),
        config.database.carts_table_name.clone(),
        config.database.region.clone(),
    ));
    info!("Repositories initialized successfully");

    // Initialize event emitter if enabled
    let food_service = if config.events.enabled {
        let event_config = EventConfig {
            event_bus_name: config.events.event_bus_name.clone(),
            source_name: config.events.source_name.clone(),
            retry_attempts: config.events.retry_attempts,
            timeout_seconds: config.events.timeout_seconds,
            enable_dead_letter_queue: config.events.enable_dead_letter_queue,
            enabled: config.events.enabled,
        };

        match EventEmitter::new(config.aws.eventbridge_client.clone(), event_config) {
            Ok(event_emitter) => {
                info!("Event emitter initialized successfully");
                info!(
                    "Events bus_name={}, source_name={}",
                    config.events.event_bus_name, config.events.source_name
                );
                Arc::new(FoodService::new_with_event_emitter(
                    food_repository.clone(),
                    Arc::new(event_emitter),
                ))
            }
            Err(e) => {
                warn!(
                    "Failed to initialize event emitter: {}, continuing without events",
                    e
                );
                Arc::new(FoodService::new(food_repository.clone()))
            }
        }
    } else {
        info!("Event emission disabled");
        Arc::new(FoodService::new(food_repository.clone()))
    };

    let cart_service = Arc::new(CartService::new(
        cart_repository,
        food_repository,
        config.database.assets_cdn_url.clone(),
    ));
    info!("Services initialized successfully");

    // Build the application router
    let app = create_app(
        metrics,
        food_service,
        cart_service,
        table_manager,
        config.database.foods_table_name.clone(),
        config.database.carts_table_name.clone(),
        config.database.assets_cdn_url.clone(),
    );

    // Create socket address
    let addr = SocketAddr::new(config.server.host.parse()?, config.server.port);

    info!("Server listening on {}", addr);

    // Create TCP listener
    let listener = TcpListener::bind(addr).await?;

    // Set up graceful shutdown
    let shutdown_signal = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install CTRL+C signal handler");
        info!("Shutdown signal received");
        shutdown_observability().await;
    };

    // Start the server with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await?;

    info!("Server shutdown complete");
    Ok(())
}

fn create_app(
    metrics: Arc<Metrics>,
    food_service: Arc<FoodService>,
    cart_service: Arc<CartService>,
    table_manager: Arc<TableManager>,
    foods_table_name: String,
    carts_table_name: String,
    assets_cdn_url: String,
) -> Router {
    let metrics_for_middleware = metrics.clone();

    // Create the API state
    let api_state = api::ApiState {
        food_service: food_service.clone(),
        cart_service,
        assets_cdn_url: assets_cdn_url.clone(),
    };

    // Create the admin state
    let admin_state = admin::AdminState {
        food_service: food_service.clone(),
        table_manager,
        foods_table_name,
        carts_table_name,
        assets_cdn_url,
    };

    Router::new()
        // Health and metrics endpoints (with metrics state)
        .route("/health/status", get(health_check))
        .route("/metrics", get(metrics_handler))
        .with_state(metrics)
        // API endpoints (with API state) - read-only food endpoints
        .route("/api/foods", get(api::list_foods))
        .route("/api/foods/:food_id", get(api::get_food))
        .route(
            "/api/cart/:user_id",
            get(api::get_cart).delete(api::delete_cart),
        )
        .route("/api/cart/:user_id/items", post(api::add_cart_item))
        .route(
            "/api/cart/:user_id/items/:food_id",
            put(api::update_cart_item).delete(api::remove_cart_item),
        )
        .route("/api/cart/:user_id/clear", post(api::clear_cart))
        .route("/api/cart/:user_id/checkout", post(api::checkout_cart))
        .with_state(api_state)
        // Admin endpoints (with admin state)
        .route("/api/admin/setup-tables", post(admin::setup_tables))
        .route("/api/admin/seed", post(admin::seed_database))
        .route("/api/admin/cleanup", post(admin::cleanup_database))
        .route("/api/admin/foods", post(admin::create_food))
        .route(
            "/api/admin/foods/:food_id",
            put(admin::update_food).delete(admin::delete_food),
        )
        .with_state(admin_state)
        // Add middleware layers (order matters - outer to inner)
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(middleware::from_fn(cors_middleware))
        .layer(middleware::from_fn(request_validation_middleware))
        .layer(middleware::from_fn(move |req, next| {
            observability_middleware(metrics_for_middleware.clone(), req, next)
        }))
}
