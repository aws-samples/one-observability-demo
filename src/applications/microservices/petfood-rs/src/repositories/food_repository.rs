use async_trait::async_trait;
use aws_sdk_dynamodb::operation::RequestId;
use aws_sdk_dynamodb::types::{AttributeValue, Select};
use aws_sdk_dynamodb::{Client as DynamoDbClient, Error as DynamoDbError};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{error, info, instrument, warn, Instrument};

use crate::models::{
    AvailabilityStatus, Food, FoodFilters, FoodType, PetType, RepositoryError, RepositoryResult,
};

/// Trait defining the interface for food data access operations
#[async_trait]
pub trait FoodRepository: Send + Sync {
    /// Find all foods with optional filters
    async fn find_all(&self, filters: FoodFilters) -> RepositoryResult<Vec<Food>>;

    /// Find a food by its ID
    async fn find_by_id(&self, id: &str) -> RepositoryResult<Option<Food>>;

    /// Find foods by pet type using GSI
    async fn find_by_pet_type(&self, pet_type: PetType) -> RepositoryResult<Vec<Food>>;

    /// Find foods by food type using GSI
    async fn find_by_food_type(&self, food_type: FoodType) -> RepositoryResult<Vec<Food>>;

    /// Create a new food item
    async fn create(&self, food: Food) -> RepositoryResult<Food>;

    /// Update an existing food item
    async fn update(&self, food: Food) -> RepositoryResult<Food>;

    /// Soft delete a food item (mark as inactive)
    async fn soft_delete(&self, id: &str) -> RepositoryResult<()>;

    /// Hard delete a food item (for testing/cleanup)
    async fn delete(&self, id: &str) -> RepositoryResult<()>;

    /// Check if a food exists
    async fn exists(&self, id: &str) -> RepositoryResult<bool>;

    /// Count total foods with optional filters
    async fn count(&self, filters: Option<FoodFilters>) -> RepositoryResult<usize>;
}

/// DynamoDB implementation of the FoodRepository trait
pub struct DynamoDbFoodRepository {
    client: Arc<DynamoDbClient>,
    table_name: String,
    pet_type_index: String,
    food_type_index: String,
    region: String,
}

impl DynamoDbFoodRepository {
    /// Create a new DynamoDB food repository
    pub fn new(client: Arc<DynamoDbClient>, table_name: String, region: String) -> Self {
        Self {
            client,
            table_name: table_name.clone(),
            pet_type_index: "PetTypeIndex".to_string(),
            food_type_index: "FoodTypeIndex".to_string(),
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

    /// Get the pet type index name (for testing)
    pub fn pet_type_index(&self) -> &str {
        &self.pet_type_index
    }

    /// Get the food type index name (for testing)
    pub fn food_type_index(&self) -> &str {
        &self.food_type_index
    }

    /// Convert a Food struct to DynamoDB attribute values
    pub fn food_to_item(&self, food: &Food) -> HashMap<String, AttributeValue> {
        let mut item = HashMap::new();

        item.insert("id".to_string(), AttributeValue::S(food.id.clone()));
        item.insert(
            "pet_type".to_string(),
            AttributeValue::S(food.pet_type.to_string()),
        );
        item.insert("name".to_string(), AttributeValue::S(food.name.clone()));
        item.insert(
            "food_type".to_string(),
            AttributeValue::S(food.food_type.to_string()),
        );
        item.insert(
            "description".to_string(),
            AttributeValue::S(food.description.clone()),
        );
        item.insert(
            "price".to_string(),
            AttributeValue::N(food.price.to_string()),
        );
        // Handle optional image
        if let Some(ref image_path) = food.image {
            item.insert("image".to_string(), AttributeValue::S(image_path.clone()));
        }

        // Handle optional nutritional info
        if let Some(ref nutritional_info) = food.nutritional_info {
            let mut nutrition_map = HashMap::new();

            if let Some(calories) = nutritional_info.calories_per_serving {
                nutrition_map.insert(
                    "calories_per_serving".to_string(),
                    AttributeValue::N(calories.to_string()),
                );
            }
            if let Some(protein) = nutritional_info.protein_percentage {
                nutrition_map.insert(
                    "protein_percentage".to_string(),
                    AttributeValue::N(protein.to_string()),
                );
            }
            if let Some(fat) = nutritional_info.fat_percentage {
                nutrition_map.insert(
                    "fat_percentage".to_string(),
                    AttributeValue::N(fat.to_string()),
                );
            }
            if let Some(carbs) = nutritional_info.carbohydrate_percentage {
                nutrition_map.insert(
                    "carbohydrate_percentage".to_string(),
                    AttributeValue::N(carbs.to_string()),
                );
            }
            if let Some(fiber) = nutritional_info.fiber_percentage {
                nutrition_map.insert(
                    "fiber_percentage".to_string(),
                    AttributeValue::N(fiber.to_string()),
                );
            }
            if let Some(moisture) = nutritional_info.moisture_percentage {
                nutrition_map.insert(
                    "moisture_percentage".to_string(),
                    AttributeValue::N(moisture.to_string()),
                );
            }
            if let Some(ref serving_size) = nutritional_info.serving_size {
                nutrition_map.insert(
                    "serving_size".to_string(),
                    AttributeValue::S(serving_size.clone()),
                );
            }
            if let Some(servings) = nutritional_info.servings_per_container {
                nutrition_map.insert(
                    "servings_per_container".to_string(),
                    AttributeValue::N(servings.to_string()),
                );
            }

            if !nutrition_map.is_empty() {
                item.insert(
                    "nutritional_info".to_string(),
                    AttributeValue::M(nutrition_map),
                );
            }
        }

        // Convert ingredients list
        let ingredients: Vec<AttributeValue> = food
            .ingredients
            .iter()
            .map(|ingredient| AttributeValue::S(ingredient.clone()))
            .collect();
        item.insert("ingredients".to_string(), AttributeValue::L(ingredients));

        // Handle optional feeding guidelines
        if let Some(ref guidelines) = food.feeding_guidelines {
            item.insert(
                "feeding_guidelines".to_string(),
                AttributeValue::S(guidelines.clone()),
            );
        }

        item.insert(
            "availability_status".to_string(),
            AttributeValue::S(food.availability_status.to_string()),
        );
        item.insert(
            "stock_quantity".to_string(),
            AttributeValue::N(food.stock_quantity.to_string()),
        );
        item.insert(
            "created_at".to_string(),
            AttributeValue::S(food.created_at.to_rfc3339()),
        );
        item.insert(
            "updated_at".to_string(),
            AttributeValue::S(food.updated_at.to_rfc3339()),
        );
        item.insert(
            "is_active".to_string(),
            AttributeValue::Bool(food.is_active),
        );

        item
    }

    /// Convert DynamoDB item to Food struct
    pub fn item_to_food(&self, item: HashMap<String, AttributeValue>) -> RepositoryResult<Food> {
        use crate::models::NutritionalInfo;
        use chrono::DateTime;
        use rust_decimal::Decimal;
        use std::str::FromStr;

        let id = item
            .get("id")
            .and_then(|v| v.as_s().ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Missing id".to_string(),
            })?
            .clone();

        let pet_type = item
            .get("pet_type")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| PetType::from_str(s).ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid pet_type".to_string(),
            })?;

        let name = item
            .get("name")
            .and_then(|v| v.as_s().ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Missing name".to_string(),
            })?
            .clone();

        let food_type = item
            .get("food_type")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| FoodType::from_str(s).ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid food_type".to_string(),
            })?;

        let description = item
            .get("description")
            .and_then(|v| v.as_s().ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Missing description".to_string(),
            })?
            .clone();

        let price = item
            .get("price")
            .and_then(|v| v.as_n().ok())
            .and_then(|s| Decimal::from_str(s).ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid price".to_string(),
            })?;

        // Image is optional - may be None if not yet generated
        let image = item.get("image").and_then(|v| v.as_s().ok()).cloned();

        // Parse optional nutritional info
        let nutritional_info = item
            .get("nutritional_info")
            .and_then(|v| v.as_m().ok())
            .map(|nutrition_map| NutritionalInfo {
                calories_per_serving: nutrition_map
                    .get("calories_per_serving")
                    .and_then(|v| v.as_n().ok())
                    .and_then(|s| s.parse().ok()),
                protein_percentage: nutrition_map
                    .get("protein_percentage")
                    .and_then(|v| v.as_n().ok())
                    .and_then(|s| Decimal::from_str(s).ok()),
                fat_percentage: nutrition_map
                    .get("fat_percentage")
                    .and_then(|v| v.as_n().ok())
                    .and_then(|s| Decimal::from_str(s).ok()),
                carbohydrate_percentage: nutrition_map
                    .get("carbohydrate_percentage")
                    .and_then(|v| v.as_n().ok())
                    .and_then(|s| Decimal::from_str(s).ok()),
                fiber_percentage: nutrition_map
                    .get("fiber_percentage")
                    .and_then(|v| v.as_n().ok())
                    .and_then(|s| Decimal::from_str(s).ok()),
                moisture_percentage: nutrition_map
                    .get("moisture_percentage")
                    .and_then(|v| v.as_n().ok())
                    .and_then(|s| Decimal::from_str(s).ok()),
                serving_size: nutrition_map
                    .get("serving_size")
                    .and_then(|v| v.as_s().ok())
                    .cloned(),
                servings_per_container: nutrition_map
                    .get("servings_per_container")
                    .and_then(|v| v.as_n().ok())
                    .and_then(|s| s.parse().ok()),
            });

        // Parse ingredients list
        let ingredients = item
            .get("ingredients")
            .and_then(|v| v.as_l().ok())
            .map(|list| list.iter().filter_map(|v| v.as_s().ok()).cloned().collect())
            .unwrap_or_default();

        let feeding_guidelines = item
            .get("feeding_guidelines")
            .and_then(|v| v.as_s().ok())
            .cloned();

        let availability_status = item
            .get("availability_status")
            .and_then(|v| v.as_s().ok())
            .and_then(|s| AvailabilityStatus::from_str(s).ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid availability_status".to_string(),
            })?;

        let stock_quantity = item
            .get("stock_quantity")
            .and_then(|v| v.as_n().ok())
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| RepositoryError::InvalidQuery {
                message: "Invalid stock_quantity".to_string(),
            })?;

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

        let is_active = item
            .get("is_active")
            .and_then(|v| v.as_bool().ok())
            .copied()
            .unwrap_or(true);

        Ok(Food {
            id,
            pet_type,
            name,
            food_type,
            description,
            price,
            image,
            nutritional_info,
            ingredients,
            feeding_guidelines,
            availability_status,
            stock_quantity,
            created_at,
            updated_at,
            is_active,
        })
    }

    /// Convert DynamoDB error to RepositoryError
    fn map_dynamodb_error(&self, error: DynamoDbError) -> RepositoryError {
        error!("DynamoDB error: {:?}", error);

        // Check for ResourceNotFoundException specifically
        if let Some(service_error) = error.as_service_error() {
            if service_error.is_resource_not_found_exception() {
                return RepositoryError::TableNotFound {
                    table_name: self.table_name.clone(),
                };
            }
        }

        RepositoryError::AwsSdk {
            message: error.to_string(),
        }
    }
}

#[async_trait]
impl FoodRepository for DynamoDbFoodRepository {
    #[instrument(skip(self), fields(table = %self.table_name))]
    async fn find_all(&self, filters: FoodFilters) -> RepositoryResult<Vec<Food>> {
        info!("Finding all foods with filters");

        // If we have a pet_type filter, use the GSI for better performance
        if let Some(pet_type) = filters.pet_type {
            return self.find_by_pet_type(pet_type).await;
        }

        // If we have a food_type filter, use the GSI for better performance
        if let Some(food_type) = filters.food_type {
            return self.find_by_food_type(food_type).await;
        }

        // Otherwise, scan the table (less efficient but necessary for complex filters)
        let mut scan_builder = self
            .client
            .scan()
            .table_name(&self.table_name)
            .select(Select::AllAttributes);

        // Add filter expressions for other criteria
        let mut filter_expressions = Vec::new();
        let mut expression_attribute_values = HashMap::new();
        let mut expression_attribute_names = HashMap::new();

        if let Some(status) = filters.availability_status {
            filter_expressions.push("availability_status = :status".to_string());
            expression_attribute_values
                .insert(":status".to_string(), AttributeValue::S(status.to_string()));
        }

        if let Some(min_price) = filters.min_price {
            filter_expressions.push("price >= :min_price".to_string());
            expression_attribute_values.insert(
                ":min_price".to_string(),
                AttributeValue::N(min_price.to_string()),
            );
        }

        if let Some(max_price) = filters.max_price {
            filter_expressions.push("price <= :max_price".to_string());
            expression_attribute_values.insert(
                ":max_price".to_string(),
                AttributeValue::N(max_price.to_string()),
            );
        }

        if let Some(true) = filters.in_stock_only {
            filter_expressions.push("is_active = :active AND stock_quantity > :zero".to_string());
            expression_attribute_values.insert(":active".to_string(), AttributeValue::Bool(true));
            expression_attribute_values
                .insert(":zero".to_string(), AttributeValue::N("0".to_string()));
        }

        if let Some(ref search_term) = filters.search_term {
            filter_expressions
                .push("contains(#name, :search) OR contains(description, :search)".to_string());
            expression_attribute_names.insert("#name".to_string(), "name".to_string());
            expression_attribute_values.insert(
                ":search".to_string(),
                AttributeValue::S(search_term.clone()),
            );
        }

        if !filter_expressions.is_empty() {
            scan_builder = scan_builder.filter_expression(filter_expressions.join(" AND "));
        }

        if !expression_attribute_values.is_empty() {
            scan_builder =
                scan_builder.set_expression_attribute_values(Some(expression_attribute_values));
        }

        if !expression_attribute_names.is_empty() {
            scan_builder =
                scan_builder.set_expression_attribute_names(Some(expression_attribute_names));
        }

        let response = scan_builder
            .send()
            .await
            .map_err(|e| self.map_dynamodb_error(e.into()))?;

        let mut foods = Vec::new();
        if let Some(items) = response.items {
            for item in items {
                match self.item_to_food(item) {
                    Ok(food) => foods.push(food),
                    Err(e) => {
                        warn!("Failed to parse food item: {}", e);
                        continue;
                    }
                }
            }
        }

        info!("Found {} foods", foods.len());
        Ok(foods)
    }

    #[instrument(skip(self), fields(table = %self.table_name, id = %id))]
    async fn find_by_id(&self, id: &str) -> RepositoryResult<Option<Food>> {
        info!("Finding food by ID");

        // Create a DynamoDB subsegment
        let get_span = self.create_dynamodb_span("GetItem");

        let response = async {
            let result = self
                .client
                .get_item()
                .table_name(&self.table_name)
                .key("id", AttributeValue::S(id.to_string()))
                .send()
                .await;

            // Record additional span attributes based on response
            match &result {
                Ok(output) => {
                    tracing::Span::current().record("http.status_code", 200);
                    if let Some(request_id) = output.request_id() {
                        tracing::Span::current().record("aws.request_id", request_id);
                    }
                }
                Err(e) => {
                    tracing::Span::current().record("http.status_code", 400); // Generic error code
                    error!("DynamoDB GetItem failed: {}", e);
                }
            }

            result.map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(get_span)
        .await?;

        match response.item {
            Some(item) => {
                let food = self.item_to_food(item)?;
                info!("Food found");
                Ok(Some(food))
            }
            None => {
                info!("Food not found");
                Ok(None)
            }
        }
    }

    #[instrument(skip(self), fields(table = %self.table_name, pet_type = %pet_type))]
    async fn find_by_pet_type(&self, pet_type: PetType) -> RepositoryResult<Vec<Food>> {
        info!("Finding foods by pet type using GSI");

        // Create a DynamoDB subsegment
        let query_span = self.create_dynamodb_span("Query");

        let response = async {
            self.client
                .query()
                .table_name(&self.table_name)
                .index_name(&self.pet_type_index)
                .key_condition_expression("pet_type = :pet_type")
                .expression_attribute_values(":pet_type", AttributeValue::S(pet_type.to_string()))
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(query_span)
        .await?;

        let mut foods = Vec::new();
        if let Some(items) = response.items {
            for item in items {
                match self.item_to_food(item) {
                    Ok(food) => foods.push(food),
                    Err(e) => {
                        warn!("Failed to parse food item: {}", e);
                        continue;
                    }
                }
            }
        }

        info!("Found {} foods for pet type {}", foods.len(), pet_type);
        Ok(foods)
    }

    #[instrument(skip(self), fields(table = %self.table_name, food_type = %food_type))]
    async fn find_by_food_type(&self, food_type: FoodType) -> RepositoryResult<Vec<Food>> {
        info!("Finding foods by food type using GSI");

        // Create a DynamoDB subsegment
        let query_span = self.create_dynamodb_span("Query");

        let response = async {
            self.client
                .query()
                .table_name(&self.table_name)
                .index_name(&self.food_type_index)
                .key_condition_expression("food_type = :food_type")
                .expression_attribute_values(":food_type", AttributeValue::S(food_type.to_string()))
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(query_span)
        .await?;

        let mut foods = Vec::new();
        if let Some(items) = response.items {
            for item in items {
                match self.item_to_food(item) {
                    Ok(food) => foods.push(food),
                    Err(e) => {
                        warn!("Failed to parse food item: {}", e);
                        continue;
                    }
                }
            }
        }

        info!("Found {} foods for food type {}", foods.len(), food_type);
        Ok(foods)
    }

    #[instrument(skip(self, food), fields(table = %self.table_name, id = %food.id))]
    async fn create(&self, food: Food) -> RepositoryResult<Food> {
        info!("Creating new food");

        let item = self.food_to_item(&food);

        // Create a DynamoDB subsegment
        let put_span = self.create_dynamodb_span("PutItem");

        async {
            self.client
                .put_item()
                .table_name(&self.table_name)
                .set_item(Some(item))
                .condition_expression("attribute_not_exists(id)")
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(put_span)
        .await?;

        info!("Food created successfully");
        Ok(food)
    }

    #[instrument(skip(self, food), fields(table = %self.table_name, id = %food.id))]
    async fn update(&self, food: Food) -> RepositoryResult<Food> {
        info!("Updating food");

        let item = self.food_to_item(&food);

        // Create a DynamoDB subsegment
        let put_span = self.create_dynamodb_span("PutItem");

        async {
            self.client
                .put_item()
                .table_name(&self.table_name)
                .set_item(Some(item))
                .condition_expression("attribute_exists(id)")
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(put_span)
        .await?;

        info!("Food updated successfully");
        Ok(food)
    }

    #[instrument(skip(self), fields(table = %self.table_name, id = %id))]
    async fn soft_delete(&self, id: &str) -> RepositoryResult<()> {
        info!("Soft deleting food");

        // Create a DynamoDB subsegment
        let update_span = self.create_dynamodb_span("UpdateItem");

        async {
            self.client
                .update_item()
                .table_name(&self.table_name)
                .key("id", AttributeValue::S(id.to_string()))
                .update_expression(
                    "SET is_active = :inactive, availability_status = :discontinued, updated_at = :now",
                )
                .expression_attribute_values(":inactive", AttributeValue::Bool(false))
                .expression_attribute_values(
                    ":discontinued",
                    AttributeValue::S(AvailabilityStatus::Discontinued.to_string()),
                )
                .expression_attribute_values(":now", AttributeValue::S(chrono::Utc::now().to_rfc3339()))
                .condition_expression("attribute_exists(id)")
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(update_span)
        .await?;

        info!("Food soft deleted successfully");
        Ok(())
    }

    #[instrument(skip(self), fields(table = %self.table_name, id = %id))]
    async fn delete(&self, id: &str) -> RepositoryResult<()> {
        info!("Hard deleting food");

        // Create a DynamoDB subsegment
        let delete_span = self.create_dynamodb_span("DeleteItem");

        async {
            self.client
                .delete_item()
                .table_name(&self.table_name)
                .key("id", AttributeValue::S(id.to_string()))
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))?;

            info!("Food deleted successfully");
            Ok(())
        }
        .instrument(delete_span)
        .await
    }

    #[instrument(skip(self), fields(table = %self.table_name, id = %id))]
    async fn exists(&self, id: &str) -> RepositoryResult<bool> {
        info!("Checking if food exists");

        // Create a DynamoDB subsegment
        let get_span = self.create_dynamodb_span("GetItem");

        let response = async {
            self.client
                .get_item()
                .table_name(&self.table_name)
                .key("id", AttributeValue::S(id.to_string()))
                .projection_expression("id")
                .send()
                .await
                .map_err(|e| self.map_dynamodb_error(e.into()))
        }
        .instrument(get_span)
        .await?;

        let exists = response.item.is_some();
        info!("Food exists: {}", exists);
        Ok(exists)
    }

    #[instrument(skip(self), fields(table = %self.table_name))]
    async fn count(&self, filters: Option<FoodFilters>) -> RepositoryResult<usize> {
        info!("Counting foods");

        let mut scan_builder = self
            .client
            .scan()
            .table_name(&self.table_name)
            .select(Select::Count);

        // Apply filters if provided
        if let Some(filters) = filters {
            let mut filter_expressions = Vec::new();
            let mut expression_attribute_values = HashMap::new();

            if let Some(pet_type) = filters.pet_type {
                filter_expressions.push("pet_type = :pet_type".to_string());
                expression_attribute_values.insert(
                    ":pet_type".to_string(),
                    AttributeValue::S(pet_type.to_string()),
                );
            }

            if let Some(food_type) = filters.food_type {
                filter_expressions.push("food_type = :food_type".to_string());
                expression_attribute_values.insert(
                    ":food_type".to_string(),
                    AttributeValue::S(food_type.to_string()),
                );
            }

            if let Some(status) = filters.availability_status {
                filter_expressions.push("availability_status = :status".to_string());
                expression_attribute_values
                    .insert(":status".to_string(), AttributeValue::S(status.to_string()));
            }

            if let Some(true) = filters.in_stock_only {
                filter_expressions
                    .push("is_active = :active AND stock_quantity > :zero".to_string());
                expression_attribute_values
                    .insert(":active".to_string(), AttributeValue::Bool(true));
                expression_attribute_values
                    .insert(":zero".to_string(), AttributeValue::N("0".to_string()));
            }

            if !filter_expressions.is_empty() {
                scan_builder = scan_builder
                    .filter_expression(filter_expressions.join(" AND "))
                    .set_expression_attribute_values(Some(expression_attribute_values));
            }
        }

        let response = scan_builder
            .send()
            .await
            .map_err(|e| self.map_dynamodb_error(e.into()))?;

        let count = response.count() as usize;
        info!("Food count: {}", count);
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateFoodRequest, NutritionalInfo};
    use rust_decimal_macros::dec;

    fn create_test_food() -> Food {
        let request = CreateFoodRequest {
            pet_type: PetType::Puppy,
            name: "Test Kibble".to_string(),
            food_type: FoodType::Dry,
            description: "Nutritious test food".to_string(),
            price: dec!(12.99),
            // No image field - will be generated via events
            nutritional_info: Some(NutritionalInfo {
                calories_per_serving: Some(350),
                protein_percentage: Some(dec!(25.0)),
                fat_percentage: Some(dec!(15.0)),
                carbohydrate_percentage: Some(dec!(45.0)),
                fiber_percentage: Some(dec!(5.0)),
                moisture_percentage: Some(dec!(10.0)),
                serving_size: Some("1 cup".to_string()),
                servings_per_container: Some(20),
            }),
            ingredients: vec![
                "chicken".to_string(),
                "rice".to_string(),
                "vegetables".to_string(),
            ],
            feeding_guidelines: Some("Feed twice daily".to_string()),
            stock_quantity: 10,
        };
        Food::new(request)
    }

    #[test]
    fn test_food_to_item_conversion() {
        let food = create_test_food();
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbFoodRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        let item = repo.food_to_item(&food);

        assert!(item.contains_key("id"));
        assert!(item.contains_key("pet_type"));
        assert!(item.contains_key("name"));
        assert!(item.contains_key("nutritional_info"));
        assert!(item.contains_key("ingredients"));

        // Verify specific values
        if let Some(AttributeValue::S(pet_type)) = item.get("pet_type") {
            assert_eq!(pet_type, "puppy");
        } else {
            panic!("Expected string value for pet_type");
        }

        if let Some(AttributeValue::L(ingredients)) = item.get("ingredients") {
            assert_eq!(ingredients.len(), 3);
        } else {
            panic!("Expected list value for ingredients");
        }
    }

    #[test]
    fn test_item_to_food_conversion() {
        let food = create_test_food();
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbFoodRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        let item = repo.food_to_item(&food);
        let converted_food = repo.item_to_food(item).unwrap();

        assert_eq!(converted_food.id, food.id);
        assert_eq!(converted_food.pet_type, food.pet_type);
        assert_eq!(converted_food.name, food.name);
        assert_eq!(converted_food.food_type, food.food_type);
        assert_eq!(converted_food.price, food.price);
        assert_eq!(converted_food.ingredients, food.ingredients);
        assert_eq!(converted_food.stock_quantity, food.stock_quantity);
        assert_eq!(converted_food.is_active, food.is_active);

        // Check nutritional info
        assert!(converted_food.nutritional_info.is_some());
        let nutrition = converted_food.nutritional_info.unwrap();
        assert_eq!(nutrition.calories_per_serving, Some(350));
        assert_eq!(nutrition.protein_percentage, Some(dec!(25.0)));
    }

    #[test]
    fn test_item_to_food_conversion_missing_updated_at() {
        let food = create_test_food();
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbFoodRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        let mut item = repo.food_to_item(&food);

        // Remove the updated_at field to simulate legacy data
        item.remove("updated_at");

        let converted_food = repo.item_to_food(item).unwrap();

        assert_eq!(converted_food.id, food.id);
        assert_eq!(converted_food.name, food.name);
        assert_eq!(converted_food.pet_type, food.pet_type);
        assert_eq!(converted_food.food_type, food.food_type);
        assert_eq!(converted_food.price, food.price);

        // When updated_at is missing, it should fallback to created_at
        assert_eq!(converted_food.updated_at, converted_food.created_at);
    }

    #[test]
    fn test_repository_creation() {
        let config = aws_sdk_dynamodb::Config::builder()
            .region(aws_sdk_dynamodb::config::Region::new("us-east-1"))
            .behavior_version(aws_sdk_dynamodb::config::BehaviorVersion::latest())
            .build();
        let client = Arc::new(aws_sdk_dynamodb::Client::from_conf(config));
        let repo =
            DynamoDbFoodRepository::new(client, "test-table".to_string(), "us-east-1".to_string());

        assert_eq!(repo.table_name, "test-table");
        assert_eq!(repo.pet_type_index, "PetTypeIndex");
        assert_eq!(repo.food_type_index, "FoodTypeIndex");
    }

    // Note: Integration tests with actual DynamoDB would be in a separate test file
    // using testcontainers or LocalStack for a real DynamoDB instance
}
