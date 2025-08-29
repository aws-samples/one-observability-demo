use async_trait::async_trait;
use aws_sdk_dynamodb::types::AttributeValue;
use aws_sdk_dynamodb::{Client as DynamoDbClient, Error as DynamoDbError};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{error, info, instrument, warn, Instrument};

use crate::models::{Cart, CartItem, RepositoryError, RepositoryResult};

/// Trait defining the interface for cart data access operations
#[async_trait]
pub trait CartRepository: Send + Sync {
    /// Find a cart by user ID
    async fn find_cart(&self, user_id: &str) -> RepositoryResult<Option<Cart>>;

    /// Save a cart (create or update)
    async fn save_cart(&self, cart: Cart) -> RepositoryResult<Cart>;

    /// Delete a cart
    async fn delete_cart(&self, user_id: &str) -> RepositoryResult<()>;

    /// Check if a cart exists for a user
    async fn cart_exists(&self, user_id: &str) -> RepositoryResult<bool>;

    /// Get all carts (for admin/testing purposes)
    async fn find_all_carts(&self) -> RepositoryResult<Vec<Cart>>;

    /// Count total number of carts
    async fn count_carts(&self) -> RepositoryResult<usize>;
}

/// DynamoDB implementation of the CartRepository trait
pub struct DynamoDbCartRepository {
    client: Arc<DynamoDbClient>,
    table_name: String,
    region: String,
}

impl DynamoDbCartRepository {
    /// Create a new DynamoDB cart repository
    pub fn new(client: Arc<DynamoDbClient>, table_name: String, region: String) -> Self {
        Self {
            client,
            table_name,
            region,
        }
    }

    /// Create a DynamoDB subsegment span with proper X-Ray attributes
    fn create_dynamodb_span(&self, operation: &str) -> tracing::Span {
        tracing::info_span!(
            "DynamoDB",
            // AWS X-Ray specific attributes
            "aws.service" = "DynamoDB",
            "aws.operation" = operation,
            "aws.region" = %self.region,
            "aws.dynamodb.table_name" = %self.table_name,
            "aws.request_id" = tracing::field::Empty,
            "aws.agent" = "rust-aws-sdk",

            // Resource identification for X-Ray
            "aws.remote.service" = "AWS::DynamoDB",
            "aws.remote.operation" = operation,
            "aws.remote.resource.type" = "AWS::DynamoDB::Table",
            "aws.remote.resource.identifier" = %self.table_name,
            "remote.resource.cfn.primary.identifier" = %self.table_name,

            // Table-specific attributes
            "table_name" = %self.table_name,
            "table.name" = %self.table_name,
            "resource_names" = format!("[{}]", self.table_name),
            "endpoint" = format!("https://dynamodb.{}.amazonaws.com", self.region),

            // OpenTelemetry semantic conventions
            "otel.kind" = "client",
            "otel.name" = format!("DynamoDB.{}", operation),

            // RPC semantic conventions for AWS API calls
            "rpc.system" = "aws-api",
            "rpc.service" = "AmazonDynamoDBv2",
            "rpc.method" = operation,

            // HTTP semantic conventions (AWS APIs are HTTP-based)
            "http.method" = "POST",
            "http.url" = format!("https://dynamodb.{}.amazonaws.com", self.region),
            "http.status_code" = tracing::field::Empty,

            // Database semantic conventions
            "db.system" = "dynamodb",
            "db.name" = %self.table_name,
            "db.operation" = operation,

            // Component identification for X-Ray
            "component" = "aws-sdk-dynamodb",
        )
    }

    /// Get the table name (for testing)
    pub fn table_name(&self) -> &str {
        &self.table_name
    }

    /// Convert a Cart struct to DynamoDB attribute values
    pub fn cart_to_item(&self, cart: &Cart) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();

        item.insert(
            "user_id".to_string(),
            AttributeValue::S(cart.user_id.clone()),
        );

        // Convert cart items to DynamoDB list
        let items: Vec<AttributeValue> = cart
            .items
            .iter()
            .map(|cart_item| {
                let mut item_map = HashMap::new();
                item_map.insert(
                    "food_id".to_string(),
                    AttributeValue::S(cart_item.food_id.clone()),
                );
                item_map.insert(
                    "quantity".to_string(),
                    AttributeValue::N(cart_item.quantity.to_string()),
                );
                item_map.insert(
                    "unit_price".to_string(),
                    AttributeValue::N(cart_item.unit_price.to_string()),
                );
                item_map.insert(
                    "added_at".to_string(),
                    AttributeValue::S(cart_item.added_at.to_rfc3339()),
                );
                AttributeValue::M(item_map)
            })
            .collect();

        item.insert("items".to_string(), AttributeValue::L(items));
        item.insert(
            "created_at".to_string(),
            AttributeValue::S(cart.created_at.to_rfc3339()),
        );
        item.insert(
            "updated_at".to_string(),
            AttributeValue::S(cart.updated_at.to_rfc3339()),
        );

        item
    }

    /// Convert DynamoDB item to Cart struct
    pub fn item_to_cart(&self, item: HashMap<String, AttributeValue>) -> RepositoryResult<Cart> {
        use chrono::DateTime;

        let user_id = item
            .get("user_id")
            .and_then(|v| v.as_s().ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Missing user_id".to_string(),
            })?
            .clone();

        // Parse cart items
        let items = item
            .get("items")
            .and_then(|v| v.as_l().ok())
            .map(|list| {
                list.iter()
                    .filter_map(|item_attr| {
                        if let Ok(item_map) = item_attr.as_m() {
                            self.map_to_cart_item(item_map).ok()
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        let created_at = item
            .get("created_at")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid created_at".to_string(),
            })?;

        let updated_at = item
            .get("updated_at")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .unwrap_or_else(|| {
                // If updated_at is missing or invalid, use created_at as fallback
                created_at
            });

        Ok(Cart {
            user_id,
            items,
            created_at,
            updated_at,
        })
    }

    /// Convert DynamoDB map to CartItem
    pub fn map_to_cart_item(
        &self,
        item_map: &HashMap<String, AttributeValue>,
    ) -> RepositoryResult<CartItem> {
        use chrono::DateTime;
        use rust_decimal::Decimal;
        use std::str::FromStr;

        let food_id = item_map
            .get("food_id")
            .and_then(|v| v.as_s().ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Missing food_id in cart item".to_string(),
            })?
            .clone();

        let quantity = item_map
            .get("quantity")
            .and_then(|v| v.as_n().ok())
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid quantity in cart item".to_string(),
            })?;

        let unit_price = item_map
            .get("unit_price")
            .and_then(|v| v.as_n().ok())
            .and_then(|s| Decimal::from_str(s).ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid unit_price in cart item".to_string(),
            })?;

        let added_at = item_map
            .get("added_at")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid added_at in cart item".to_string(),
            })?;

        Ok(CartItem {
            food_id,
            quantity,
            unit_price,
            added_at,
        })
    }

    /// Convert DynamoDB error to RepositoryError
    fn map_dynamodb_error(&self, error: DynamoDbError) -> RepositoryError {
        error!("DynamoDB error: {:?}", error);
        RepositoryError::AwsSdk {
            message: error.to_string(),
        }
    }
}

#[async_trait]
impl CartRepository for DynamoDbCartRepository {
    #[instrument(skip(self), fields(table = %self.table_name, user_id = %user_id))]
    async fn find_cart(&self, user_id: &str) -> RepositoryResult<Option<Cart>> {
        info!("Finding cart for user");

        // Create a DynamoDB subsegment
        let get_span = self.create_dynamodb_span("GetItem");

        let response = async {
            self.client
                .get_item()
                .table_name(&self.table_name)
                .key("user_id", AttributeValue::S(user_id.to_string()))
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(get_span)
        .await?;

        match response.item {
            Some(item) => {
                let cart = self.item_to_cart(item)?;
                info!("Cart found with {} items", cart.items.len());
                Ok(Some(cart))
            }
            None => {
                info!("Cart not found");
                Ok(None)
            }
        }
    }

    #[instrument(skip(self, cart), fields(table = %self.table_name, user_id = %cart.user_id, item_count = cart.items.len()))]
    async fn save_cart(&self, cart: Cart) -> RepositoryResult<Cart> {
        info!("Saving cart");

        let item = self.cart_to_item(&cart);

        // Create a DynamoDB subsegment
        let put_span = self.create_dynamodb_span("PutItem");

        async {
            self.client
                .put_item()
                .table_name(&self.table_name)
                .set_item(Some(item))
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(put_span)
        .await?;

        info!("Cart saved successfully");
        Ok(cart)
    }

    #[instrument(skip(self), fields(table = %self.table_name, user_id = %user_id))]
    async fn delete_cart(&self, user_id: &str) -> RepositoryResult<()> {
        info!("Deleting cart");

        // Create a DynamoDB subsegment
        let delete_span = self.create_dynamodb_span("DeleteItem");

        async {
            self.client
                .delete_item()
                .table_name(&self.table_name)
                .key("user_id", AttributeValue::S(user_id.to_string()))
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))?;

            info!("Cart deleted successfully");
            Ok(())
        }
        .instrument(delete_span)
        .await
    }

    #[instrument(skip(self), fields(table = %self.table_name, user_id = %user_id))]
    async fn cart_exists(&self, user_id: &str) -> RepositoryResult<bool> {
        info!("Checking if cart exists");

        // Create a DynamoDB subsegment
        let get_span = self.create_dynamodb_span("GetItem");

        let response = async {
            self.client
                .get_item()
                .table_name(&self.table_name)
                .key("user_id", AttributeValue::S(user_id.to_string()))
                .projection_expression("user_id")
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(get_span)
        .await?;

        let exists = response.item.is_some();
        info!("Cart exists: {}", exists);
        Ok(exists)
    }

    #[instrument(skip(self), fields(table = %self.table_name))]
    async fn find_all_carts(&self) -> RepositoryResult<Vec<Cart>> {
        info!("Finding all carts");

        // Create a DynamoDB subsegment
        let scan_span = self.create_dynamodb_span("Scan");

        let response = async {
            self.client
                .scan()
                .table_name(&self.table_name)
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(scan_span)
        .await?;

        let mut carts = Vec::new();
        if let Some(items) = response.items {
            for item in items {
                match self.item_to_cart(item) {
                    Ok(cart) => carts.push(cart),
                    Err(e) => {
                        warn!("Failed to parse cart item: {}", e);
                        continue;
                    }
                }
            }
        }

        info!("Found {} carts", carts.len());
        Ok(carts)
    }

    #[instrument(skip(self), fields(table = %self.table_name))]
    async fn count_carts(&self) -> RepositoryResult<usize> {
        info!("Counting carts");

        // Create a DynamoDB subsegment
        let scan_span = self.create_dynamodb_span("Scan");

        let response = async {
            self.client
                .scan()
                .table_name(&self.table_name)
                .select(aws_sdk_dynamodb::types::Select::Count)
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(scan_span)
        .await?;

        let count = response.count() as usize;
        info!("Cart count: {}", count);
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn create_test_cart() -> Cart {
        let mut cart = Cart::new("user123".to_string());
        cart.add_item("F001".to_string(), 2, dec!(12.99));
        cart.add_item("F002".to_string(), 1, dec!(8.99));
        cart
    }

    #[test]
    fn test_cart_to_item_conversion() {
        let cart = create_test_cart();
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbCartRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        let item = repo.cart_to_item(&cart);

        assert!(item.contains_key("user_id"));
        assert!(item.contains_key("items"));
        assert!(item.contains_key("created_at"));
        assert!(item.contains_key("updated_at"));

        // Verify user_id
        if let Some(AttributeValue::S(user_id)) = item.get("user_id") {
            assert_eq!(user_id, "user123");
        } else {
            panic!("Expected string value for user_id");
        }

        // Verify items list
        if let Some(AttributeValue::L(items)) = item.get("items") {
            assert_eq!(items.len(), 2);

            // Check first item structure
            if let AttributeValue::M(first_item) = &items[0] {
                assert!(first_item.contains_key("food_id"));
                assert!(first_item.contains_key("quantity"));
                assert!(first_item.contains_key("unit_price"));
                assert!(first_item.contains_key("added_at"));
            } else {
                panic!("Expected map value for cart item");
            }
        } else {
            panic!("Expected list value for items");
        }
    }

    #[test]
    fn test_item_to_cart_conversion() {
        let cart = create_test_cart();
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbCartRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        let item = repo.cart_to_item(&cart);
        let converted_cart = repo.item_to_cart(item).unwrap();

        assert_eq!(converted_cart.user_id, cart.user_id);
        assert_eq!(converted_cart.items.len(), cart.items.len());

        // Check first item
        let original_item = &cart.items[0];
        let converted_item = &converted_cart.items[0];

        assert_eq!(converted_item.food_id, original_item.food_id);
        assert_eq!(converted_item.quantity, original_item.quantity);
        assert_eq!(converted_item.unit_price, original_item.unit_price);

        // Timestamps should be preserved (within reasonable precision)
        let time_diff = (converted_item.added_at - original_item.added_at)
            .num_milliseconds()
            .abs();
        assert!(
            time_diff < 1000,
            "Timestamp difference too large: {}ms",
            time_diff
        );
    }

    #[test]
    fn test_empty_cart_conversion() {
        let cart = Cart::new("user456".to_string());
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbCartRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        let item = repo.cart_to_item(&cart);
        let converted_cart = repo.item_to_cart(item).unwrap();

        assert_eq!(converted_cart.user_id, cart.user_id);
        assert!(converted_cart.items.is_empty());
        assert_eq!(converted_cart.total_items(), 0);
    }

    #[test]
    fn test_map_to_cart_item() {
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbCartRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        let mut item_map = HashMap::new();
        item_map.insert("food_id".to_string(), AttributeValue::S("F001".to_string()));
        item_map.insert("quantity".to_string(), AttributeValue::N("3".to_string()));
        item_map.insert(
            "unit_price".to_string(),
            AttributeValue::N("15.99".to_string()),
        );
        item_map.insert(
            "added_at".to_string(),
            AttributeValue::S(chrono::Utc::now().to_rfc3339()),
        );

        let cart_item = repo.map_to_cart_item(&item_map).unwrap();

        assert_eq!(cart_item.food_id, "F001");
        assert_eq!(cart_item.quantity, 3);
        assert_eq!(cart_item.unit_price, dec!(15.99));
    }

    #[test]
    fn test_repository_creation() {
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo = DynamoDbCartRepository::new(
            client,
            "test-cart-table".to_string(),
            "us-east-1".to_string(),
        );

        assert_eq!(repo.table_name(), "test-cart-table");
    }

    #[test]
    fn test_item_to_cart_conversion_missing_updated_at() {
        let cart = create_test_cart();
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbCartRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        let mut item = repo.cart_to_item(&cart);

        // Remove the updated_at field to simulate legacy data
        item.remove("updated_at");

        let converted_cart = repo.item_to_cart(item).unwrap();

        assert_eq!(converted_cart.user_id, cart.user_id);
        assert_eq!(converted_cart.items.len(), cart.items.len());

        // When updated_at is missing, it should fallback to created_at
        assert_eq!(converted_cart.updated_at, converted_cart.created_at);
    }

    #[test]
    fn test_invalid_cart_item_handling() {
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbCartRepository::new(client, "test-table".to_string(), "us-east-1".to_string());
        // Missing required field
        let mut invalid_item_map = HashMap::new();
        invalid_item_map.insert("quantity".to_string(), AttributeValue::N("3".to_string()));
        // Missing food_id, unit_price, added_at

        let result = repo.map_to_cart_item(&invalid_item_map);
        assert!(result.is_err());

        match result.unwrap_err() {
            RepositoryError::InvalidQuery { message } => {
                assert!(message.contains("Missing food_id"));
            }
            _ => panic!("Expected InvalidQuery error"),
        }
    }

    // Note: Integration tests with actual DynamoDB would be in a separate test file
    // using testcontainers or LocalStack for a real DynamoDB instance
}
