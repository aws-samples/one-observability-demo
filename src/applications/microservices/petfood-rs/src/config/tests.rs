#[cfg(test)]
mod config_tests {
    use crate::config::{
        default_assets_cdn_url, default_carts_table, default_foods_table, default_host,
        default_log_level, default_max_request_size, default_metrics_port,
        default_otlp_endpoint_option, default_port, default_region, default_service_name,
        default_timeout, ConfigError, DatabaseConfig, ObservabilityConfig, ParameterStoreConfig,
        ServerConfig,
    };
    use aws_sdk_ssm::Client as SsmClient;
    use std::env;
    use std::time::Duration;

    #[test]
    fn test_server_config_defaults() {
        // Ensure no environment variables are set
        env::remove_var("PETFOOD_HOST");
        env::remove_var("PETFOOD_PORT");
        env::remove_var("PETFOOD_REQUEST_TIMEOUT_SECONDS");
        env::remove_var("PETFOOD_MAX_REQUEST_SIZE");

        // Wait a bit to ensure environment changes take effect
        std::thread::sleep(std::time::Duration::from_millis(10));

        let config = ServerConfig::from_env().unwrap();

        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 8080);
        assert_eq!(config.request_timeout_seconds, 30);
        assert_eq!(config.max_request_size, 1024 * 1024);
    }

    #[test]
    fn test_database_config_from_env() {
        env::set_var("PETFOOD_FOODS_TABLE_NAME", "TestFoods");
        env::set_var("PETFOOD_CARTS_TABLE_NAME", "TestCarts");
        env::set_var("PETFOOD_REGION", "us-west-2");

        let config = DatabaseConfig::from_env().unwrap();

        assert_eq!(config.foods_table_name, "TestFoods");
        assert_eq!(config.carts_table_name, "TestCarts");
        assert_eq!(config.region, "us-west-2");

        // Clean up
        env::remove_var("PETFOOD_FOODS_TABLE_NAME");
        env::remove_var("PETFOOD_CARTS_TABLE_NAME");
        env::remove_var("PETFOOD_REGION");
    }

    #[test]
    fn test_observability_config_from_env() {
        env::set_var("PETFOOD_SERVICE_NAME", "test-service");
        env::set_var("PETFOOD_SERVICE_VERSION", "1.0.0");
        env::set_var("PETFOOD_OTLP_ENDPOINT", "http://test:4317");
        env::set_var("PETFOOD_METRICS_PORT", "9091");
        env::set_var("PETFOOD_LOG_LEVEL", "debug");

        let config = ObservabilityConfig::from_env().unwrap();

        assert_eq!(config.service_name, "test-service");
        assert_eq!(config.service_version, "1.0.0");
        //assert_eq!(config.otlp_endpoint, Some("http://test:4317".to_string()));
        assert_eq!(config.metrics_port, 9091);
        assert_eq!(config.log_level, "debug");

        // Clean up
        env::remove_var("PETFOOD_SERVICE_NAME");
        env::remove_var("PETFOOD_SERVICE_VERSION");
        env::remove_var("PETFOOD_OTLP_ENDPOINT");
        env::remove_var("PETFOOD_METRICS_PORT");
        env::remove_var("PETFOOD_LOG_LEVEL");
    }

    #[test]
    fn test_server_config_request_timeout() {
        let config = ServerConfig {
            host: "localhost".to_string(),
            port: 8080,
            request_timeout_seconds: 45,
            max_request_size: 1024,
        };

        assert_eq!(config.request_timeout(), Duration::from_secs(45));
    }

    #[tokio::test]
    async fn test_parameter_store_config_cache() {
        // Create a mock AWS config for testing
        let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(aws_config::Region::new("us-west-2"))
            .load()
            .await;

        let ssm_client = SsmClient::new(&aws_config);
        let parameter_store = ParameterStoreConfig::new(ssm_client, Duration::from_secs(60));

        // Test cache functionality
        assert_eq!(parameter_store.cache_size().await, 0);

        // Test get_parameter_with_default
        let default_value = parameter_store
            .get_parameter_with_default("/nonexistent/parameter", "default_value")
            .await;
        assert_eq!(default_value, "default_value");

        // Test cache clearing
        parameter_store.clear_cache().await;
        assert_eq!(parameter_store.cache_size().await, 0);
    }

    #[test]
    fn test_config_error_display() {
        let error = ConfigError::ParameterNotFound {
            name: "test_param".to_string(),
        };
        assert_eq!(error.to_string(), "Parameter not found: test_param");

        let error = ConfigError::ValidationError {
            message: "Invalid configuration".to_string(),
        };
        assert_eq!(error.to_string(), "Validation error: Invalid configuration");

        let error = ConfigError::MissingEnvironmentVariable {
            name: "TEST_VAR".to_string(),
        };
        assert_eq!(error.to_string(), "Environment variable missing: TEST_VAR");
    }

    #[test]
    fn test_default_values() {
        // Clean up any environment variables that might affect defaults
        env::remove_var("PETFOOD_OTLP_ENDPOINT");
        env::remove_var("PETFOOD_ENABLE_JSON_LOGGING");

        assert_eq!(default_host(), "0.0.0.0");
        assert_eq!(default_port(), 8080);
        assert_eq!(default_timeout(), 30);
        assert_eq!(default_max_request_size(), 1024 * 1024);
        assert_eq!(default_foods_table(), "PetFoods");
        assert_eq!(default_carts_table(), "PetFoodCarts");
        assert_eq!(default_region(), "us-west-2");
        assert_eq!(default_assets_cdn_url(), "");
        assert_eq!(default_service_name(), "petfood-rs");
        assert_eq!(default_otlp_endpoint_option(), "http://localhost:4317",);
        assert_eq!(default_metrics_port(), 9090);
        assert_eq!(default_log_level(), "info");
    }
}
