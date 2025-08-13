use axum::{
    middleware,
    routing::{get, post, put},
    Router,
};
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tracing::info;

use petfood_rs::{
    handlers::{
        health_check, metrics_handler, api, admin,
        request_validation_middleware, cors_middleware, security_headers_middleware,
    },
    observability::{observability_middleware, Metrics},
    repositories::{DynamoDbFoodRepository, DynamoDbCartRepository, TableManager},
    services::{FoodService, RecommendationService, CartService},
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

    // Initialize AWS clients
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let dynamodb_client = Arc::new(aws_sdk_dynamodb::Client::new(&aws_config));
    info!("AWS clients initialized successfully");

    // Initialize table manager
    let table_manager = Arc::new(TableManager::new(dynamodb_client.clone()));
    info!("Table manager initialized successfully");

    // Initialize repositories
    let food_repository = Arc::new(DynamoDbFoodRepository::new(
        dynamodb_client.clone(),
        config.database.foods_table_name.clone(),
    ));
    let cart_repository = Arc::new(DynamoDbCartRepository::new(
        dynamodb_client.clone(),
        config.database.carts_table_name.clone(),
    ));
    info!("Repositories initialized successfully");

    // Initialize services
    let food_service = Arc::new(FoodService::new(food_repository.clone()));
    let recommendation_service = Arc::new(RecommendationService::new(food_repository.clone()));
    let cart_service = Arc::new(CartService::new(cart_repository, food_repository));
    info!("Services initialized successfully");

    // Build the application router
    let app = create_app(
        metrics, 
        food_service, 
        recommendation_service, 
        cart_service,
        table_manager,
        config.database.foods_table_name.clone(),
        config.database.carts_table_name.clone(),
    );

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

fn create_app(
    metrics: Arc<Metrics>,
    food_service: Arc<FoodService>,
    recommendation_service: Arc<RecommendationService>,
    cart_service: Arc<CartService>,
    table_manager: Arc<TableManager>,
    foods_table_name: String,
    carts_table_name: String,
) -> Router {
    let metrics_for_middleware = metrics.clone();
    
    // Create the API state
    let api_state = api::ApiState {
        food_service: food_service.clone(),
        recommendation_service,
        cart_service,
    };
    
    // Create the admin state
    let admin_state = admin::AdminState {
        food_service: food_service.clone(),
        table_manager,
        foods_table_name,
        carts_table_name,
    };
    
    Router::new()
        // Health and metrics endpoints (with metrics state)
        .route("/health/status", get(health_check))
        .route("/metrics", get(metrics_handler))
        .with_state(metrics)
        
        // API endpoints (with API state)
        .route("/api/foods", get(api::list_foods).post(api::create_food))
        .route("/api/foods/:food_id", 
               get(api::get_food)
               .put(api::update_food)
               .delete(api::delete_food))
        .route("/api/recommendations/:pet_type", get(api::get_recommendations))
        .route("/api/cart/:user_id", 
               get(api::get_cart)
               .delete(api::delete_cart))
        .route("/api/cart/:user_id/items", post(api::add_cart_item))
        .route("/api/cart/:user_id/items/:food_id", 
               put(api::update_cart_item)
               .delete(api::remove_cart_item))
        .route("/api/cart/:user_id/clear", post(api::clear_cart))
        .route("/api/cart/:user_id/checkout", post(api::checkout_cart))
        .with_state(api_state)
        
        // Admin endpoints (with admin state)
        .route("/api/admin/setup-tables", post(admin::setup_tables))
        .route("/api/admin/seed", post(admin::seed_database))
        .route("/api/admin/cleanup", post(admin::cleanup_database))
        .with_state(admin_state)
        
        // Add middleware layers (order matters - outer to inner)
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(middleware::from_fn(cors_middleware))
        .layer(middleware::from_fn(request_validation_middleware))
        .layer(middleware::from_fn(move |req, next| {
            observability_middleware(metrics_for_middleware.clone(), req, next)
        }))
}

