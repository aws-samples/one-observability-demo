use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use aws_sdk_eventbridge::Client as EventBridgeClient;
use aws_sdk_ssm::Client as SsmClient;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tracing::{debug, error, info, warn};

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Configuration loading error: {message}")]
    LoadError { message: String },

    #[error("Parameter not found: {name}")]
    ParameterNotFound { name: String },

    #[error("AWS SDK error: {source}")]
    AwsSdk {
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[error("Validation error: {message}")]
    ValidationError { message: String },

    #[error("Environment variable missing: {name}")]
    MissingEnvironmentVariable { name: String },
}

#[derive(Debug, Clone)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub aws: AwsConfig,
    pub observability: ObservabilityConfig,
    pub events: EventsConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_timeout")]
    pub request_timeout_seconds: u64,
    #[serde(default = "default_max_request_size")]
    pub max_request_size: usize,
}

// Database config object may receive SSM Parameter names
// as env values injected by CDK
#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default)]
    pub foods_table_name: String,
    #[serde(default)]
    pub carts_table_name: String,
    #[serde(default = "default_region")]
    pub region: String,
    #[serde(default)]
    pub images_cdn_url: String,
    // SSM parameter prefix for this deployment
    #[serde(default = "default_ssm_param_prefix")]
    pub ssm_param_prefix: String,
}

#[derive(Debug, Clone)]
pub struct AwsConfig {
    pub region: String,
    pub dynamodb_client: DynamoDbClient,
    pub eventbridge_client: EventBridgeClient,
    pub ssm_client: SsmClient,
    pub parameter_store: Arc<ParameterStoreConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ObservabilityConfig {
    #[serde(default = "default_service_name")]
    pub service_name: String,
    #[serde(default = "default_service_version")]
    pub service_version: String,
    #[serde(default = "default_otlp_endpoint_option")]
    pub otlp_endpoint: String,
    #[serde(default = "default_metrics_port")]
    pub metrics_port: u16,
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default = "default_enable_json_logging")]
    pub enable_json_logging: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventsConfig {
    #[serde(default = "default_events_enabled")]
    pub enabled: bool,
    #[serde(default = "default_event_bus_name")]
    pub event_bus_name: String,
    #[serde(default = "default_source_name")]
    pub source_name: String,
    #[serde(default = "default_retry_attempts")]
    pub retry_attempts: u32,
    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
    #[serde(default = "default_enable_dead_letter_queue")]
    pub enable_dead_letter_queue: bool,
}

pub struct ParameterStoreConfig {
    ssm_client: SsmClient,
}

impl std::fmt::Debug for ParameterStoreConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ParameterStoreConfig").finish()
    }
}

impl Config {
    pub async fn from_environment() -> Result<Self, ConfigError> {
        println!("Loading configuration from environment and AWS Parameter Store");

        // Load basic configuration from environment variables
        let server = ServerConfig::from_env()?;
        let mut database = DatabaseConfig::from_env()?;
        let observability = ObservabilityConfig::from_env()?;
        let events = EventsConfig::from_env()?;

        // Initialize AWS configuration with timeout and retry settings
        println!(
            "Initializing AWS configuration for region: {}",
            database.region
        );

        let aws_config = aws_config::defaults(BehaviorVersion::latest())
            .region(aws_config::Region::new(database.region.clone()))
            .timeout_config(
                aws_config::timeout::TimeoutConfig::builder()
                    .operation_timeout(Duration::from_secs(60))
                    .operation_attempt_timeout(Duration::from_secs(30))
                    .build(),
            )
            .retry_config(aws_config::retry::RetryConfig::standard().with_max_attempts(3))
            .load()
            .await;

        println!("AWS configuration loaded successfully");

        let dynamodb_client = DynamoDbClient::new(&aws_config);
        let eventbridge_client = EventBridgeClient::new(&aws_config);
        let ssm_client = SsmClient::new(&aws_config);

        // Create parameter store configuration
        let parameter_store = Arc::new(ParameterStoreConfig::new(ssm_client.clone()));

        // Resolve database configuration
        // Priority: SSM (using prefix + param name) → Env Vars → Defaults
        println!(
            "Using SSM parameter prefix: PETFOOD_SSM_PARAM_PREFIX={}",
            database.ssm_param_prefix
        );

        // Resolve foods table name using dynamic SSM parameter resolution
        database.foods_table_name = parameter_store
            .resolve_parameter_with_prefix(
                &database.ssm_param_prefix,
                "PETFOOD_FOODS_TABLE_NAME", // Env var (value becomes SSM param name)
            )
            .await;

        // Resolve carts table name using dynamic SSM parameter resolution
        database.carts_table_name = parameter_store
            .resolve_parameter_with_prefix(
                &database.ssm_param_prefix,
                "PETFOOD_CARTS_TABLE_NAME", // Env var (value becomes SSM param name)
            )
            .await;

        // Resolve CDN URL using dynamic SSM parameter resolution
        database.images_cdn_url = parameter_store
            .resolve_parameter_with_prefix(
                &database.ssm_param_prefix,
                "PETFOOD_IMAGES_CDN_URL", // Env var (value becomes SSM param name)
            )
            .await;

        println!(
            "Database configuration resolved: foods_table={}, carts_table={}, assets_cdn_url={}",
            database.foods_table_name, database.carts_table_name, database.images_cdn_url
        );

        let aws = AwsConfig {
            region: database.region.clone(),
            dynamodb_client,
            eventbridge_client,
            ssm_client,
            parameter_store,
        };

        let config = Config {
            server,
            database,
            aws,
            observability,
            events,
        };

        // Validate configuration
        config.validate().await?;

        println!("Configuration loaded successfully");
        debug!("Configuration: {:?}", config);

        Ok(config)
    }

    async fn validate(&self) -> Result<(), ConfigError> {
        info!("Validating configuration");

        // Validate server configuration
        if self.server.port == 0 {
            return Err(ConfigError::ValidationError {
                message: "Server port cannot be 0".to_string(),
            });
        }

        if self.server.request_timeout_seconds == 0 {
            return Err(ConfigError::ValidationError {
                message: "Request timeout cannot be 0".to_string(),
            });
        }

        // Validate database configuration
        if self.database.foods_table_name.is_empty() {
            return Err(ConfigError::ValidationError {
                message: "Foods table name cannot be empty".to_string(),
            });
        }

        if self.database.carts_table_name.is_empty() {
            return Err(ConfigError::ValidationError {
                message: "Carts table name cannot be empty".to_string(),
            });
        }

        // Assets CDN URL is optional - if empty, images will be served without CDN prefix
        if !self.database.images_cdn_url.is_empty() {
            info!(
                "Assets CDN URL configured: {}",
                self.database.images_cdn_url
            );
        } else {
            info!("Assets CDN URL not configured - images will be served without CDN prefix");
        }

        // Test AWS connectivity for troubleshooting
        info!("Testing AWS connectivity for troubleshooting");

        // Test SSM connectivity
        match self.aws.ssm_client.describe_parameters().send().await {
            Ok(_) => {
                info!("AWS SSM connectivity validated successfully");
            }
            Err(e) => {
                warn!(
                    error = %e,
                    region = %self.aws.region,
                    "AWS SSM connectivity test failed - this may indicate credential or network issues"
                );
                // Don't fail validation for connectivity issues in development
            }
        }

        // Test DynamoDB connectivity by checking if tables exist
        info!(
            foods_table = %self.database.foods_table_name,
            carts_table = %self.database.carts_table_name,
            "Testing DynamoDB connectivity"
        );

        // Test foods table
        match self
            .aws
            .dynamodb_client
            .describe_table()
            .table_name(&self.database.foods_table_name)
            .send()
            .await
        {
            Ok(response) => {
                let table_status = response
                    .table()
                    .and_then(|t| t.table_status())
                    .map(|s| s.as_str())
                    .unwrap_or("unknown");
                info!(
                    table = %self.database.foods_table_name,
                    status = %table_status,
                    "DynamoDB foods table connectivity validated"
                );
            }
            Err(e) => {
                error!(
                    table = %self.database.foods_table_name,
                    error = %e,
                    region = %self.aws.region,
                    "DynamoDB foods table connectivity test failed - check table exists and IAM permissions"
                );
            }
        }

        // Test carts table
        match self
            .aws
            .dynamodb_client
            .describe_table()
            .table_name(&self.database.carts_table_name)
            .send()
            .await
        {
            Ok(response) => {
                let table_status = response
                    .table()
                    .and_then(|t| t.table_status())
                    .map(|s| s.as_str())
                    .unwrap_or("unknown");
                info!(
                    table = %self.database.carts_table_name,
                    status = %table_status,
                    "DynamoDB carts table connectivity validated"
                );
            }
            Err(e) => {
                error!(
                    table = %self.database.carts_table_name,
                    error = %e,
                    region = %self.aws.region,
                    "DynamoDB carts table connectivity test failed - check table exists and IAM permissions"
                );
            }
        }

        info!("Configuration validation completed");
        Ok(())
    }
}

impl ServerConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let settings = config::Config::builder()
            // cSpell:ignore PETFOOD
            .add_source(config::Environment::with_prefix("PETFOOD"))
            .build()
            .map_err(|e| ConfigError::LoadError {
                message: format!("Failed to load server config: {}", e),
            })?;

        settings
            .try_deserialize()
            .map_err(|e| ConfigError::LoadError {
                message: format!("Failed to deserialize server config: {}", e),
            })
    }

    pub fn request_timeout(&self) -> Duration {
        Duration::from_secs(self.request_timeout_seconds)
    }
}

impl DatabaseConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let settings = config::Config::builder()
            .add_source(config::Environment::with_prefix("PETFOOD"))
            .build()
            .map_err(|e| ConfigError::LoadError {
                message: format!("Failed to load database config: {}", e),
            })?;

        settings
            .try_deserialize()
            .map_err(|e| ConfigError::LoadError {
                message: format!("Failed to deserialize database config: {}", e),
            })
    }
}

impl ObservabilityConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let settings = config::Config::builder()
            .add_source(config::Environment::with_prefix("PETFOOD"))
            .build()
            .map_err(|e| ConfigError::LoadError {
                message: format!("Failed to load observability config: {}", e),
            })?;

        settings
            .try_deserialize()
            .map_err(|e| ConfigError::LoadError {
                message: format!("Failed to deserialize observability config: {}", e),
            })
    }
}

impl EventsConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let settings = config::Config::builder()
            .add_source(config::Environment::with_prefix("PETFOOD"))
            .build()
            .map_err(|e| ConfigError::LoadError {
                message: format!("Failed to load events config: {}", e),
            })?;

        settings
            .try_deserialize()
            .map_err(|e| ConfigError::LoadError {
                message: format!("Failed to deserialize events config: {}", e),
            })
    }
}

impl ParameterStoreConfig {
    pub fn new(ssm_client: SsmClient) -> Self {
        Self { ssm_client }
    }

    pub async fn get_parameter(&self, name: &str) -> Result<String, ConfigError> {
        debug!("Getting parameter: {}", name);

        // Fetch from Parameter Store
        debug!("Fetching parameter from AWS SSM: {}", name);
        let result = self
            .ssm_client
            .get_parameter()
            .name(name)
            .with_decryption(false)
            .send()
            .await
            .map_err(|e| ConfigError::AwsSdk {
                source: Box::new(e),
            })?;

        let value = result
            .parameter()
            .and_then(|p| p.value())
            .ok_or_else(|| ConfigError::ParameterNotFound {
                name: name.to_string(),
            })?
            .to_string();

        debug!("Parameter retrieved and cached: {}", name);
        Ok(value)
    }

    pub async fn get_parameter_with_default(&self, name: &str, default: &str) -> String {
        match self.get_parameter(name).await {
            Ok(value) => value,
            Err(e) => {
                debug!("Failed to get parameter {}, using default: {}", name, e);
                default.to_string()
            }
        }
    }

    /// Dynamic SSM parameter resolution
    /// If SSM prefix is set: Try SSM using prefix + env_var_value → No Default (empty string)
    /// If SSM prefix is empty: Use env_var_value directly → No Default (empty string)
    pub async fn resolve_parameter_with_prefix(
        &self,
        ssm_prefix: &str,
        env_var_name: &str,
    ) -> String {
        // Check if SSM prefix is configured
        if !ssm_prefix.is_empty() {
            // Get the parameter name from the environment variable
            if let Ok(env_param_name) = std::env::var(env_var_name) {
                if !env_param_name.is_empty() {
                    // Construct SSM path: prefix + env_var_value
                    let full_ssm_path =
                        format!("{}/{}", ssm_prefix.trim_end_matches('/'), env_param_name);

                    // Try SSM first
                    match self.get_parameter(&full_ssm_path).await {
                        Ok(ssm_value) => {
                            println!(
                                "Parameter {} resolved from SSM path {}: {}",
                                env_var_name, full_ssm_path, ssm_value
                            );
                            return ssm_value;
                        }
                        Err(e) => {
                            println!(
                                "Parameter {} not found in SSM path {} ({})",
                                env_var_name, full_ssm_path, e
                            );
                        }
                    }
                }
            }

            // SSM failed, use default
            println!(
                "Parameter {} using default (SSM prefix configured but failed)",
                env_var_name
            );
            // forcing an empty string as return, should fail API requests if not provided
            "".to_string()
        } else {
            // No SSM prefix configured, use environment variable directly
            if let Ok(env_value) = std::env::var(env_var_name) {
                if !env_value.is_empty() {
                    println!(
                        "Parameter resolved from environment (no SSM prefix): {}={}",
                        env_var_name, env_value
                    );
                    return env_value;
                }
            }
            "".to_string()
        }
    }
}

// Default value functions
pub(crate) fn default_host() -> String {
    "0.0.0.0".to_string()
}

pub(crate) fn default_port() -> u16 {
    8080
}

pub(crate) fn default_timeout() -> u64 {
    30
}

pub(crate) fn default_max_request_size() -> usize {
    1024 * 1024 // 1MB
}

pub(crate) fn default_region() -> String {
    // Use the standard AWS_REGION environment variable provided by ECS
    std::env::var("AWS_REGION").unwrap_or_else(|_| "us-west-2".to_string())
}

pub(crate) fn default_service_name() -> String {
    "petfood-rs".to_string()
}

pub(crate) fn default_service_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub(crate) fn default_otlp_endpoint_option() -> String {
    "http://localhost:4317".to_string()
}

pub(crate) fn default_enable_json_logging() -> bool {
    std::env::var("PETFOOD_ENABLE_JSON_LOGGING")
        .map(|v| v.to_lowercase() == "true")
        .unwrap_or(false)
}

pub(crate) fn default_metrics_port() -> u16 {
    9090
}

pub(crate) fn default_log_level() -> String {
    "info".to_string()
}

pub(crate) fn default_events_enabled() -> bool {
    std::env::var("PETFOOD_EVENTS_ENABLED")
        .map(|v| v.to_lowercase() == "true")
        .unwrap_or(true)
}

pub(crate) fn default_event_bus_name() -> String {
    "default".to_string()
}

pub(crate) fn default_source_name() -> String {
    "petfood.service".to_string()
}

pub(crate) fn default_retry_attempts() -> u32 {
    3
}

pub(crate) fn default_timeout_seconds() -> u64 {
    30
}

pub(crate) fn default_enable_dead_letter_queue() -> bool {
    true
}

pub(crate) fn default_ssm_param_prefix() -> String {
    "".to_string()
}

#[cfg(test)]
mod tests;
