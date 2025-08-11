use petfood_rs::Config;
use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Set some environment variables for demonstration
    env::set_var("PETFOOD_SERVER_HOST", "127.0.0.1");
    env::set_var("PETFOOD_SERVER_PORT", "8080");
    env::set_var("PETFOOD_DATABASE_FOODS_TABLE_NAME", "DemoFoods");
    env::set_var("PETFOOD_DATABASE_CARTS_TABLE_NAME", "DemoCarts");
    env::set_var("PETFOOD_DATABASE_REGION", "us-west-2");
    env::set_var("PETFOOD_OBSERVABILITY_SERVICE_NAME", "demo-service");
    env::set_var("PETFOOD_ERROR_SIMULATION_ENABLED", "true");

    println!("Loading configuration...");

    match Config::from_environment().await {
        Ok(config) => {
            println!("✅ Configuration loaded successfully!");
            println!("Server: {}:{}", config.server.host, config.server.port);
            println!("Region: {}", config.aws.region);
            println!("Foods Table: {}", config.database.foods_table_name);
            println!("Carts Table: {}", config.database.carts_table_name);
            println!("Service: {} v{}", 
                     config.observability.service_name, 
                     config.observability.service_version);
            println!("Error Simulation: {}", config.error_simulation.enabled);
            
            // Test parameter store functionality
            println!("\nTesting Parameter Store...");
            let test_value = config.aws.parameter_store
                .get_parameter_with_default("/nonexistent/param", "default_value")
                .await;
            println!("Parameter with default: {}", test_value);
            
            println!("Cache size: {}", config.aws.parameter_store.cache_size().await);
        }
        Err(e) => {
            println!("❌ Failed to load configuration: {}", e);
            return Err(Box::new(e) as Box<dyn std::error::Error>);
        }
    }

    println!("✅ Configuration demo completed successfully!");
    Ok(())
}