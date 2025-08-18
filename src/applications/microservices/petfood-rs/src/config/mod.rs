use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use aws_sdk_ssm::Client as SsmClient;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::RwLock;
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

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_foods_table")]
    pub foods_table_name: String,
    #[serde(default = "default_carts_table")]
    pub carts_table_name: String,
    #[serde(default = "default_region")]
    pub region: String,
}

#[derive(Debug, Clone)]
pub struct AwsConfig {
    pub region: String,
    pub dynamodb_client: DynamoDbClient,
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
    pub otlp_endpoint: Option<String>,
    #[serde(default = "default_metrics_port")]
    pub metrics_port: u16,
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default = "default_enable_json_logging")]
    pub enable_json_logging: bool,
}

pub struct ParameterStoreConfig {
    ssm_client: SsmClient,
    cache: Arc<RwLock<HashMap<String, (String, Instant)>>>,
    cache_ttl: Duration,
}

impl std::fmt::Debug for ParameterStoreConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ParameterStoreConfig")
            .field("cache_ttl", &self.cache_ttl)
            .field("cache_size", &"<runtime>")
            .finish()
    }
}

impl Config {
    pub async fn from_environment() -> Result<Self, ConfigError> {
        info!("Loading configuration from environment and AWS Parameter Store");

        // Load basic configuration from environment variables
        let server = ServerConfig::from_env()?;
        let database = DatabaseConfig::from_env()?;
        let observability = ObservabilityConfig::from_env()?;

        // Initialize AWS configuration
        let aws_config = aws_config::defaults(BehaviorVersion::latest())
            .region(aws_config::Region::new(database.region.clone()))
            .load()
            .await;

        let dynamodb_client = DynamoDbClient::new(&aws_config);
        let ssm_client = SsmClient::new(&aws_config);

        // Create parameter store configuration
        let parameter_store = Arc::new(ParameterStoreConfig::new(
            ssm_client.clone(),
            Duration::from_secs(5 * 60),
        ));

        let aws = AwsConfig {
            region: database.region.clone(),
            dynamodb_client,
            ssm_client,
            parameter_store,
        };

        let config = Config {
            server,
            database,
            aws,
            observability,
        };

        // Validate configuration
        config.validate().await?;

        info!("Configuration loaded successfully");
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

        // Test AWS connectivity
        match self.aws.ssm_client.describe_parameters().send().await {
            Ok(_) => {
                info!("AWS SSM connectivity validated");
            }
            Err(e) => {
                warn!("AWS SSM connectivity test failed: {}", e);
                // Don't fail validation for connectivity issues in development
            }
        }

        info!("Configuration validation completed");
        Ok(())
    }
}

impl ServerConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let settings = config::Config::builder()
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

impl ParameterStoreConfig {
    pub fn new(ssm_client: SsmClient, cache_ttl: Duration) -> Self {
        Self {
            ssm_client,
            cache: Arc::new(RwLock::new(HashMap::new())),
            cache_ttl,
        }
    }

    pub async fn get_parameter(&self, name: &str) -> Result<String, ConfigError> {
        debug!("Getting parameter: {}", name);

        // Check cache first
        {
            let cache = self.cache.read().await;
            if let Some((value, timestamp)) = cache.get(name) {
                if timestamp.elapsed() < self.cache_ttl {
                    debug!("Parameter found in cache: {}", name);
                    return Ok(value.clone());
                } else {
                    debug!("Parameter cache expired: {}", name);
                }
            }
        }

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

        // Update cache
        {
            let mut cache = self.cache.write().await;
            cache.insert(name.to_string(), (value.clone(), Instant::now()));
        }

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

    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
        info!("Parameter store cache cleared");
    }

    pub async fn cache_size(&self) -> usize {
        let cache = self.cache.read().await;
        cache.len()
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

pub(crate) fn default_foods_table() -> String {
    "PetFoods".to_string()
}

pub(crate) fn default_carts_table() -> String {
    "PetFoodCarts".to_string()
}

pub(crate) fn default_region() -> String {
    "us-west-2".to_string()
}

pub(crate) fn default_service_name() -> String {
    "petfood-rs".to_string()
}

pub(crate) fn default_service_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub(crate) fn default_otlp_endpoint_option() -> Option<String> {
    std::env::var("PETFOOD_OTLP_ENDPOINT").ok()
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

#[cfg(test)]
mod tests;
