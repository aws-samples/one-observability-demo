use aws_sdk_dynamodb::{Client as DynamoDbClient, Error as DynamoDbError};
use aws_sdk_dynamodb::types::{
    AttributeDefinition, BillingMode, GlobalSecondaryIndex, KeySchemaElement, KeyType,
    Projection, ProjectionType, ScalarAttributeType, TableStatus,
};
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, instrument, warn};

use crate::models::{RepositoryError, RepositoryResult};

/// Manages DynamoDB table creation and configuration
pub struct TableManager {
    client: Arc<DynamoDbClient>,
}

impl TableManager {
    /// Create a new table manager
    pub fn new(client: Arc<DynamoDbClient>) -> Self {
        Self { client }
    }

    /// Create the PetFoods table with GSIs
    #[instrument(skip(self), fields(table_name = %table_name))]
    pub async fn create_foods_table(&self, table_name: &str) -> RepositoryResult<()> {
        info!("Creating PetFoods table");

        // Check if table already exists
        if self.table_exists(table_name).await? {
            info!("Table {} already exists", table_name);
            return Ok(());
        }

        // Define attribute definitions
        let attribute_definitions = vec![
            AttributeDefinition::builder()
                .attribute_name("food_id")
                .attribute_type(ScalarAttributeType::S)
                .build()
                .map_err(|e| RepositoryError::AwsSdk {
                    message: format!("Failed to build attribute definition: {}", e)
                })?,
            AttributeDefinition::builder()
                .attribute_name("food_for")
                .attribute_type(ScalarAttributeType::S)
                .build()
                .map_err(|e| RepositoryError::AwsSdk {
                    message: format!("Failed to build attribute definition: {}", e)
                })?,
            AttributeDefinition::builder()
                .attribute_name("food_name")
                .attribute_type(ScalarAttributeType::S)
                .build()
                .map_err(|e| RepositoryError::AwsSdk {
                    message: format!("Failed to build attribute definition: {}", e)
                })?,
            AttributeDefinition::builder()
                .attribute_name("food_type")
                .attribute_type(ScalarAttributeType::S)
                .build()
                .map_err(|e| RepositoryError::AwsSdk {
                    message: format!("Failed to build attribute definition: {}", e)
                })?,
            AttributeDefinition::builder()
                .attribute_name("food_price")
                .attribute_type(ScalarAttributeType::N)
                .build()
                .map_err(|e| RepositoryError::AwsSdk {
                    message: format!("Failed to build attribute definition: {}", e)
                })?,
        ];

        // Define key schema for main table
        let key_schema = vec![
            KeySchemaElement::builder()
                .attribute_name("food_id")
                .key_type(KeyType::Hash)
                .build()
                .map_err(|e| RepositoryError::AwsSdk {
                    message: format!("Failed to build key schema: {}", e)
                })?,
        ];

        // Define PetType GSI
        let pet_type_gsi = GlobalSecondaryIndex::builder()
            .index_name(format!("{}-PetTypeIndex", table_name))
            .key_schema(
                KeySchemaElement::builder()
                    .attribute_name("food_for")
                    .key_type(KeyType::Hash)
                    .build()
                    .map_err(|e| RepositoryError::AwsSdk {
                        message: format!("Failed to build GSI key schema: {}", e)
                    })?
            )
            .key_schema(
                KeySchemaElement::builder()
                    .attribute_name("food_name")
                    .key_type(KeyType::Range)
                    .build()
                    .map_err(|e| RepositoryError::AwsSdk {
                        message: format!("Failed to build GSI key schema: {}", e)
                    })?
            )
            .projection(
                Projection::builder()
                    .projection_type(ProjectionType::All)
                    .build()
            )
            .build()
            .map_err(|e| RepositoryError::AwsSdk {
                message: format!("Failed to build GSI: {}", e)
            })?;

        // Define FoodType GSI
        let food_type_gsi = GlobalSecondaryIndex::builder()
            .index_name(format!("{}-FoodTypeIndex", table_name))
            .key_schema(
                KeySchemaElement::builder()
                    .attribute_name("food_type")
                    .key_type(KeyType::Hash)
                    .build()
                    .map_err(|e| RepositoryError::AwsSdk {
                        message: format!("Failed to build GSI key schema: {}", e)
                    })?
            )
            .key_schema(
                KeySchemaElement::builder()
                    .attribute_name("food_price")
                    .key_type(KeyType::Range)
                    .build()
                    .map_err(|e| RepositoryError::AwsSdk {
                        message: format!("Failed to build GSI key schema: {}", e)
                    })?
            )
            .projection(
                Projection::builder()
                    .projection_type(ProjectionType::All)
                    .build()
            )
            .build()
            .map_err(|e| RepositoryError::AwsSdk {
                message: format!("Failed to build GSI: {}", e)
            })?;

        // Create the table
        self.client
            .create_table()
            .table_name(table_name)
            .set_attribute_definitions(Some(attribute_definitions))
            .set_key_schema(Some(key_schema))
            .global_secondary_indexes(pet_type_gsi)
            .global_secondary_indexes(food_type_gsi)
            .billing_mode(BillingMode::PayPerRequest)
            .send()
            .await
            .map_err(|e| self.map_dynamodb_error(e.into()))?;

        info!("Table creation initiated, waiting for table to become active");
        self.wait_for_table_active(table_name).await?;
        info!("PetFoods table created successfully");

        Ok(())
    }

    /// Create the PetFoodCarts table
    #[instrument(skip(self), fields(table_name = %table_name))]
    pub async fn create_carts_table(&self, table_name: &str) -> RepositoryResult<()> {
        info!("Creating PetFoodCarts table");

        // Check if table already exists
        if self.table_exists(table_name).await? {
            info!("Table {} already exists", table_name);
            return Ok(());
        }

        // Define attribute definitions
        let attribute_definitions = vec![
            AttributeDefinition::builder()
                .attribute_name("user_id")
                .attribute_type(ScalarAttributeType::S)
                .build()
                .map_err(|e| RepositoryError::AwsSdk {
                    message: format!("Failed to build attribute definition: {}", e)
                })?,
        ];

        // Define key schema
        let key_schema = vec![
            KeySchemaElement::builder()
                .attribute_name("user_id")
                .key_type(KeyType::Hash)
                .build()
                .map_err(|e| RepositoryError::AwsSdk {
                    message: format!("Failed to build key schema: {}", e)
                })?,
        ];

        // Create the table
        self.client
            .create_table()
            .table_name(table_name)
            .set_attribute_definitions(Some(attribute_definitions))
            .set_key_schema(Some(key_schema))
            .billing_mode(BillingMode::PayPerRequest)
            .send()
            .await
            .map_err(|e| self.map_dynamodb_error(e.into()))?;

        info!("Table creation initiated, waiting for table to become active");
        self.wait_for_table_active(table_name).await?;
        info!("PetFoodCarts table created successfully");

        Ok(())
    }

    /// Check if a table exists
    #[instrument(skip(self), fields(table_name = %table_name))]
    pub async fn table_exists(&self, table_name: &str) -> RepositoryResult<bool> {
        match self.client.describe_table().table_name(table_name).send().await {
            Ok(_) => {
                info!("Table {} exists", table_name);
                Ok(true)
            }
            Err(e) => {
                // Check if this is a ResourceNotFoundException (table doesn't exist)
                let error_string = e.to_string();
                let error_debug = format!("{:?}", e);
                
                info!("DynamoDB error details: {}", error_string);
                info!("DynamoDB error debug: {}", error_debug);
                
                // Check for various forms of "table not found" errors
                if error_string.contains("ResourceNotFoundException") 
                    || error_string.contains("Requested resource not found")
                    || error_string.contains("Table: ") && error_string.contains("not found")
                    || error_debug.contains("ResourceNotFoundException") {
                    info!("Table {} does not exist", table_name);
                    Ok(false)
                } else {
                    // For any other error, log and return the error
                    error!("Error checking table existence: {}", e);
                    Err(RepositoryError::ConnectionFailed)
                }
            }
        }
    }

    /// Wait for a table to become active
    #[instrument(skip(self), fields(table_name = %table_name))]
    async fn wait_for_table_active(&self, table_name: &str) -> RepositoryResult<()> {
        let mut attempts = 0;
        let max_attempts = 30; // 5 minutes with 10-second intervals
        let wait_duration = Duration::from_secs(10);

        loop {
            match self.client.describe_table().table_name(table_name).send().await {
                Ok(response) => {
                    if let Some(table) = response.table {
                        match table.table_status {
                            Some(TableStatus::Active) => {
                                info!("Table {} is now active", table_name);
                                return Ok(());
                            }
                            Some(status) => {
                                info!("Table {} status: {:?}, waiting...", table_name, status);
                            }
                            None => {
                                warn!("Table {} status unknown, waiting...", table_name);
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Error checking table status: {}", e);
                    return Err(self.map_dynamodb_error(e.into()));
                }
            }

            attempts += 1;
            if attempts >= max_attempts {
                error!("Timeout waiting for table {} to become active", table_name);
                return Err(RepositoryError::Timeout);
            }

            tokio::time::sleep(wait_duration).await;
        }
    }

    /// Delete a table (for testing/cleanup)
    #[instrument(skip(self), fields(table_name = %table_name))]
    pub async fn delete_table(&self, table_name: &str) -> RepositoryResult<()> {
        info!("Deleting table");

        if !self.table_exists(table_name).await? {
            info!("Table {} does not exist, nothing to delete", table_name);
            return Ok(());
        }

        self.client
            .delete_table()
            .table_name(table_name)
            .send()
            .await
            .map_err(|e| self.map_dynamodb_error(e.into()))?;

        info!("Table {} deletion initiated", table_name);
        Ok(())
    }

    /// List all tables (for debugging/admin)
    #[instrument(skip(self))]
    pub async fn list_tables(&self) -> RepositoryResult<Vec<String>> {
        info!("Listing all tables");

        let response = self.client
            .list_tables()
            .send()
            .await
            .map_err(|e| self.map_dynamodb_error(e.into()))?;

        let table_names = response.table_names.unwrap_or_default();
        info!("Found {} tables", table_names.len());
        Ok(table_names)
    }

    /// Get table description (for debugging/admin)
    #[instrument(skip(self), fields(table_name = %table_name))]
    pub async fn describe_table(&self, table_name: &str) -> RepositoryResult<String> {
        info!("Describing table");

        let response = self.client
            .describe_table()
            .table_name(table_name)
            .send()
            .await
            .map_err(|e| self.map_dynamodb_error(e.into()))?;

        let description = format!("{:#?}", response.table);
        info!("Table description retrieved");
        Ok(description)
    }

    /// Create both tables (convenience method)
    #[instrument(skip(self))]
    pub async fn create_all_tables(&self, foods_table: &str, carts_table: &str) -> RepositoryResult<()> {
        info!("Creating all tables");

        // Create tables in parallel for better performance
        let foods_future = self.create_foods_table(foods_table);
        let carts_future = self.create_carts_table(carts_table);

        let (foods_result, carts_result) = tokio::join!(foods_future, carts_future);

        foods_result?;
        carts_result?;

        info!("All tables created successfully");
        Ok(())
    }

    /// Convert DynamoDB error to RepositoryError
    fn map_dynamodb_error(&self, error: DynamoDbError) -> RepositoryError {
        error!("DynamoDB error: {:?}", error);
        RepositoryError::AwsSdk {
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;




    #[test]
    fn test_table_manager_creation() {
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let _manager = TableManager::new(client);

        // Just verify the manager can be created
        // Actual functionality tests would require integration testing with LocalStack
        assert!(true);
    }

    // Note: Most tests for this module would be integration tests
    // using testcontainers or LocalStack to test against a real DynamoDB instance
    // Unit tests are limited due to the heavy AWS SDK integration
}