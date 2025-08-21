# PetFood Microservice API Documentation
This documentation outlines the API endpoints and their usage for the PetFood Microservice.

**Base URL**: `http://localhost:8080`

## Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication](#authentication)
3. [Health Check](#health-check)
4. [Admin Endpoints](#admin-endpoints)
5. [Food Management](#food-management)
6. [Cart Management](#cart-management)
7. [Complete User Journey Example](#complete-user-journey-example)
8. [Error Handling](#error-handling)
9. [Data Models](#data-models)

---

## Getting Started

### Prerequisites
- Service running on `http://localhost:8080`
- DynamoDB tables created (use admin endpoints). Tables creation should be moved to CDK in the future

### Quick Start Sequence
1. **Setup**: Create tables using admin endpoint
2. **Seed**: Populate with sample data
3. **Use**: Interact with food and cart APIs
4. **Cleanup**: Remove all data when done

---

## Authentication

Currently, the API does not require authentication. User identification is handled through the `user_id` parameter in cart operations.

---

## Health Check

### Check Service Health

**Endpoint**: `GET /health/status`

**Description**: Verify that the service is running and healthy.

**Request**:
```bash
curl -X GET http://localhost:8080/health/status
```

**Response**:
```json
{
  "status": "healthy",
  "service": "petfood-rs",
  "version": "0.1.0",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Admin Endpoints

### 1. Setup Database Tables

**Endpoint**: `POST /api/admin/setup-tables`

**Description**: Create the required DynamoDB tables (foods and carts).

**Request**:
```bash
curl -X POST http://localhost:8080/api/admin/setup-tables \
  -H "Content-Type: application/json"
```

**Response**:
```json
{
  "message": "Successfully created 2 tables",
  "tables_created": ["foods", "carts"],
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 2. Seed Database with Sample Data

**Endpoint**: `POST /api/admin/seed`

**Description**: Populate the database with sample food products for all pet types.

**Request**:
```bash
curl -X POST http://localhost:8080/api/admin/seed \
  -H "Content-Type: application/json"
```

**Response**:
```json
{
  "message": "Database seeded successfully with 9 foods",
  "foods_created": 9,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 3. Cleanup Database

**Endpoint**: `POST /api/admin/cleanup`

**Description**: Remove all food products from the database.

**Request**:
```bash
curl -X POST http://localhost:8080/api/admin/cleanup \
  -H "Content-Type: application/json"
```

**Response**:
```json
{
  "message": "Database cleaned up successfully, deleted 9 foods",
  "foods_deleted": 9,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Food Management

### 1. List All Foods

**Endpoint**: `GET /api/foods`

**Description**: Retrieve all food products with optional filtering.

**Query Parameters**:
- `pet_type` (optional): Filter by pet type (`puppy`, `kitten`, `bunny`)
- `food_type` (optional): Filter by food type (`dry`, `wet`, `treats`, `supplements`)
- `min_price` (optional): Minimum price filter
- `max_price` (optional): Maximum price filter
- `search` (optional): Search term for food name/description
- `in_stock_only` (optional): Show only in-stock items (`true`/`false`)

**Request**:
```bash
# Get all foods
curl -X GET http://localhost:8080/api/foods

# Get puppy foods only
curl -X GET "http://localhost:8080/api/foods?pet_type=puppy"

# Get dry foods under $15
curl -X GET "http://localhost:8080/api/foods?food_type=dry&max_price=15.00"
```

**Response**:
```json
{
  "foods": [
    {
      "id": "F12345678",
      "pet_type": "puppy",
      "name": "Beef and Turkey Kibbles",
      "food_type": "dry",
      "description": "A nutritious blend of beef and turkey, specially formulated for growing puppies.",
      "price": "12.99",
      "image": "https://petfood-assets.s3.amazonaws.com/petfood/images/beef-turkey-kibbles.jpg",
      "nutritional_info": null,
      "ingredients": ["beef", "turkey", "rice", "vegetables"],
      "feeding_guidelines": "Feed 2-3 times daily based on puppy's weight",
      "availability_status": "in_stock",
      "stock_quantity": 50,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "is_active": true
    }
  ],
  "total_count": 1,
  "page": null,
  "page_size": null
}
```

### 2. Get Specific Food

**Endpoint**: `GET /api/foods/{food_id}`

**Description**: Retrieve details for a specific food product.

**Request**:
```bash
curl -X GET http://localhost:8080/api/foods/F12345678
```

**Response**:
```json
{
  "id": "F12345678",
  "pet_type": "puppy",
  "name": "Beef and Turkey Kibbles",
  "food_type": "dry",
  "description": "A nutritious blend of beef and turkey, specially formulated for growing puppies.",
  "price": "12.99",
  "image": "https://petfood-assets.s3.amazonaws.com/petfood/images/beef-turkey-kibbles.jpg",
  "nutritional_info": null,
  "ingredients": ["beef", "turkey", "rice", "vegetables"],
  "feeding_guidelines": "Feed 2-3 times daily based on puppy's weight",
  "availability_status": "in_stock",
  "stock_quantity": 50,
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "is_active": true
}
```

### 3. Create New Food (Admin Only)

**Endpoint**: `POST /api/admin/foods`

**Description**: Create a new food product. This is an admin-only operation.

**Request**:
```bash
curl -X POST http://localhost:8080/api/admin/foods \
  -H "Content-Type: application/json" \
  -d '{
    "pet_type": "puppy",
    "name": "Premium Puppy Chow",
    "food_type": "dry",
    "description": "High-quality dry food for puppies",
    "price": "24.99",
    "image": "https://petfood-assets.s3.amazonaws.com/petfood/images/premium-puppy-chow.jpg",
    "nutritional_info": {
      "calories_per_serving": 350,
      "protein_percentage": "28.0",
      "fat_percentage": "15.0",
      "serving_size": "1 cup"
    },
    "ingredients": ["chicken", "rice", "vegetables", "vitamins"],
    "feeding_guidelines": "Feed 2-3 times daily",
    "stock_quantity": 100
  }'
```

**Response** (Status: 201 Created):
```json
{
  "id": "F87654321",
  "pet_type": "puppy",
  "name": "Premium Puppy Chow",
  "food_type": "dry",
  "description": "High-quality dry food for puppies",
  "price": "24.99",
  "image": "https://petfood-assets.s3.amazonaws.com/petfood/images/premium-puppy-chow.jpg",
  "nutritional_info": {
    "calories_per_serving": 350,
    "protein_percentage": "28.0",
    "fat_percentage": "15.0",
    "carbohydrate_percentage": null,
    "fiber_percentage": null,
    "moisture_percentage": null,
    "serving_size": "1 cup",
    "servings_per_container": null
  },
  "ingredients": ["chicken", "rice", "vegetables", "vitamins"],
  "feeding_guidelines": "Feed 2-3 times daily",
  "availability_status": "in_stock",
  "stock_quantity": 100,
  "created_at": "2024-01-15T10:35:00Z",
  "updated_at": "2024-01-15T10:35:00Z",
  "is_active": true
}
```

### 4. Update Food (Admin Only)

**Endpoint**: `PUT /api/admin/foods/{food_id}`

**Description**: Update an existing food product. All fields are optional. This is an admin-only operation.

**Request**:
```bash
curl -X PUT http://localhost:8080/api/admin/foods/F87654321 \
  -H "Content-Type: application/json" \
  -d '{
    "price": "22.99",
    "stock_quantity": 75,
    "availability_status": "low_stock"
  }'
```

**Response**:
```json
{
  "id": "F87654321",
  "pet_type": "puppy",
  "name": "Premium Puppy Chow",
  "food_type": "dry",
  "description": "High-quality dry food for puppies",
  "price": "22.99",
  "image": "https://petfood-assets.s3.amazonaws.com/petfood/images/premium-puppy-chow.jpg",
  "nutritional_info": {
    "calories_per_serving": 350,
    "protein_percentage": "28.0",
    "fat_percentage": "15.0",
    "serving_size": "1 cup"
  },
  "ingredients": ["chicken", "rice", "vegetables", "vitamins"],
  "feeding_guidelines": "Feed 2-3 times daily",
  "availability_status": "low_stock",
  "stock_quantity": 75,
  "created_at": "2024-01-15T10:35:00Z",
  "updated_at": "2024-01-15T10:40:00Z",
  "is_active": true
}
```

### 5. Delete Food (Admin Only)

**Endpoint**: `DELETE /api/admin/foods/{food_id}`

**Description**: Soft delete a food product (marks as inactive). This is an admin-only operation.

**Request**:
```bash
curl -X DELETE http://localhost:8080/api/admin/foods/F87654321
```

**Response** (Status: 204 No Content):
```
(Empty response body)
```

---

## Cart Management

### 1. Get User's Cart

**Endpoint**: `GET /api/cart/{user_id}`

**Description**: Retrieve the shopping cart for a specific user.

**Request**:
```bash
curl -X GET http://localhost:8080/api/cart/user001
```

**Response** (Empty Cart):
```json
{
  "user_id": "user001",
  "items": [],
  "total_items": 0,
  "total_price": "0.00",
  "created_at": "2024-01-15T10:45:00Z",
  "updated_at": "2024-01-15T10:45:00Z"
}
```

### 2. Add Item to Cart

**Endpoint**: `POST /api/cart/{user_id}/items`

**Description**: Add a food item to the user's cart.

**Request**:
```bash
curl -X POST http://localhost:8080/api/cart/user001/items \
  -H "Content-Type: application/json" \
  -d '{
    "food_id": "F12345678",
    "quantity": 2
  }'
```

**Response** (Status: 201 Created):
```json
{
  "food_id": "F12345678",
  "name": "Beef and Turkey Kibbles",
  "image": "https://petfood-assets.s3.amazonaws.com/petfood/images/beef-turkey-kibbles.jpg",
  "quantity": 2,
  "unit_price": "12.99",
  "total_price": "25.98",
  "is_available": true,
  "added_at": "2024-01-15T10:50:00Z"
}
```

### 3. Get Cart After Adding Items

**Request**:
```bash
curl -X GET http://localhost:8080/api/cart/user001
```

**Response**:
```json
{
  "user_id": "user001",
  "items": [
    {
      "food_id": "F12345678",
      "name": "Beef and Turkey Kibbles",
      "image": "https://petfood-assets.s3.amazonaws.com/petfood/images/beef-turkey-kibbles.jpg",
      "quantity": 2,
      "unit_price": "12.99",
      "total_price": "25.98",
      "is_available": true,
      "added_at": "2024-01-15T10:50:00Z"
    }
  ],
  "total_items": 2,
  "total_price": "25.98",
  "created_at": "2024-01-15T10:45:00Z",
  "updated_at": "2024-01-15T10:50:00Z"
}
```

### 4. Update Cart Item Quantity

**Endpoint**: `PUT /api/cart/{user_id}/items/{food_id}`

**Description**: Update the quantity of a specific item in the cart.

**Request**:
```bash
curl -X PUT http://localhost:8080/api/cart/user001/items/F12345678 \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 5
  }'
```

**Response**:
```json
{
  "food_id": "F12345678",
  "name": "Beef and Turkey Kibbles",
  "image": "https://petfood-assets.s3.amazonaws.com/petfood/images/beef-turkey-kibbles.jpg",
  "quantity": 5,
  "unit_price": "12.99",
  "total_price": "64.95",
  "is_available": true,
  "added_at": "2024-01-15T10:50:00Z"
}
```

### 5. Remove Item from Cart

**Endpoint**: `DELETE /api/cart/{user_id}/items/{food_id}`

**Description**: Remove a specific item from the cart.

**Request**:
```bash
curl -X DELETE http://localhost:8080/api/cart/user001/items/F12345678
```

**Response** (Status: 204 No Content):
```
(Empty response body)
```

### 6. Clear Cart

**Endpoint**: `POST /api/cart/{user_id}/clear`

**Description**: Remove all items from the cart.

**Request**:
```bash
curl -X POST http://localhost:8080/api/cart/user001/clear
```

**Response** (Status: 204 No Content):
```
(Empty response body)
```

### 7. Checkout Cart

**Endpoint**: `POST /api/cart/{user_id}/checkout`

**Description**: Process checkout for the user's cart and create an order.

**Request**:
```bash
curl -X POST http://localhost:8080/api/cart/user001/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "payment_method": {
      "CreditCard": {
        "card_number": "4111111111111111",
        "expiry_month": 12,
        "expiry_year": 2025,
        "cvv": "123",
        "cardholder_name": "John Doe"
      }
    },
    "shipping_address": {
      "name": "John Doe",
      "street": "123 Main St",
      "city": "Seattle",
      "state": "WA",
      "zip_code": "98101",
      "country": "USA"
    },
    "billing_address": {
      "name": "John Doe",
      "street": "123 Main St",
      "city": "Seattle",
      "state": "WA",
      "zip_code": "98101",
      "country": "USA"
    }
  }'
```

**Response** (Status: 201 Created):
```json
{
  "order_id": "ORDER-USER001-1705312200",
  "user_id": "user001",
  "items": [
    {
      "food_id": "F12345678",
      "food_name": "Beef and Turkey Kibbles",
      "quantity": 2,
      "unit_price": "12.99",
      "total_price": "25.98"
    }
  ],
  "subtotal": "25.98",
  "tax": "2.34",
  "shipping": "5.99",
  "total_amount": "34.31",
  "payment_method": "CreditCard",
  "status": "confirmed",
  "created_at": "2024-01-15T11:30:00Z",
  "estimated_delivery": "2024-01-19T11:30:00Z"
}
```

### 8. Delete Cart

**Endpoint**: `DELETE /api/cart/{user_id}`

**Description**: Delete the entire cart for a user.

**Request**:
```bash
curl -X DELETE http://localhost:8080/api/cart/user001
```

**Response** (Status: 204 No Content):
```
(Empty response body)
```

---

## Complete User Journey Example

Here's a complete end-to-end example showing a typical user journey with `user001`:

### Step 1: Setup Environment

```bash
# 1. Check service health
curl -X GET http://localhost:8080/health/status

# 2. Setup database tables
curl -X POST http://localhost:8080/api/admin/setup-tables

# 3. Seed with sample data
curl -X POST http://localhost:8080/api/admin/seed
```

### Step 2: Browse Products

```bash
# 1. Get all available foods
curl -X GET http://localhost:8080/api/foods

# 2. Get puppy foods using filtering
curl -X GET "http://localhost:8080/api/foods?pet_type=puppy"

# 3. Search for dry foods under $15
curl -X GET "http://localhost:8080/api/foods?food_type=dry&max_price=15.00"
```

### Step 3: Shopping Cart Operations

```bash
# 1. Check initial cart (should be empty)
curl -X GET http://localhost:8080/api/cart/user001

# 2. Add puppy kibble to cart
curl -X POST http://localhost:8080/api/cart/user001/items \
  -H "Content-Type: application/json" \
  -d '{
    "food_id": "F12345678",
    "quantity": 2
  }'

# 3. Add puppy treats to cart
curl -X POST http://localhost:8080/api/cart/user001/items \
  -H "Content-Type: application/json" \
  -d '{
    "food_id": "F34567890",
    "quantity": 1
  }'

# 4. Check cart contents
curl -X GET http://localhost:8080/api/cart/user001

# 5. Update kibble quantity
curl -X PUT http://localhost:8080/api/cart/user001/items/F12345678 \
  -H "Content-Type: application/json" \
  -d '{
    "quantity": 3
  }'

# 6. Remove treats from cart
curl -X DELETE http://localhost:8080/api/cart/user001/items/F34567890

# 7. Final cart check
curl -X GET http://localhost:8080/api/cart/user001

# 8. Checkout the cart
curl -X POST http://localhost:8080/api/cart/user001/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "payment_method": {
      "CreditCard": {
        "card_number": "4111111111111111",
        "expiry_month": 12,
        "expiry_year": 2025,
        "cvv": "123",
        "cardholder_name": "John Doe"
      }
    },
    "shipping_address": {
      "name": "John Doe",
      "street": "123 Main St",
      "city": "Seattle",
      "state": "WA",
      "zip_code": "98101",
      "country": "USA"
    }
  }'
```

### Step 4: Cleanup

```bash
# 1. Clear user's cart
curl -X POST http://localhost:8080/api/cart/user001/clear

# 2. Clean up all data
curl -X POST http://localhost:8080/api/admin/cleanup
```

---

## Error Handling

### Common HTTP Status Codes

- **200 OK**: Successful GET, PUT requests
- **201 Created**: Successful POST requests
- **204 No Content**: Successful DELETE requests
- **400 Bad Request**: Invalid request data
- **404 Not Found**: Resource not found
- **409 Conflict**: Business logic conflict (e.g., insufficient stock)
- **500 Internal Server Error**: Server error

### Error Response Format

All errors return a JSON response with the following structure:

```json
{
  "error": "Error message describing what went wrong",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Example Error Responses

**404 Not Found**:
```json
{
  "error": "Food not found with ID: F99999999",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**400 Bad Request**:
```json
{
  "error": "Invalid pet type: invalid_pet",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**409 Conflict**:
```json
{
  "error": "Insufficient stock for food F12345678. Available: 5, Requested: 10",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**400 Bad Request (Empty Cart)**:
```json
{
  "error": "Cannot checkout empty cart",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**400 Bad Request (Invalid Payment Method)**:
```json
{
  "error": "Invalid payment method format",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Data Models

### Pet Types
- `puppy`
- `kitten`
- `bunny`

### Food Types
- `dry`
- `wet`
- `treats`
- `supplements`

### Availability Status
- `in_stock`
- `out_of_stock`
- `discontinued`
- `pre_order`

### Payment Methods
The checkout endpoint supports the following payment methods:

**Credit Card**:
```json
{
  "CreditCard": {
    "card_number": "4111111111111111",
    "expiry_month": 12,
    "expiry_year": 2025,
    "cvv": "123",
    "cardholder_name": "John Doe"
  }
}
```

**PayPal**:
```json
{
  "PayPal": {
    "email": "user@example.com"
  }
}
```

**Bank Transfer**:
```json
{
  "BankTransfer": {
    "account_number": "1234567890",
    "routing_number": "021000021"
  }
}
```

### Order Status
- `pending` - Order has been created but not yet confirmed
- `confirmed` - Order has been confirmed and payment processed
- `processing` - Order is being prepared for shipment
- `shipped` - Order has been shipped
- `delivered` - Order has been delivered
- `cancelled` - Order has been cancelled

### Nutritional Information
The nutritional info object contains the following optional fields:
- `calories_per_serving` (number) - Calories per serving
- `protein_percentage` (decimal string) - Protein percentage (e.g., "28.0")
- `fat_percentage` (decimal string) - Fat percentage (e.g., "15.0")
- `carbohydrate_percentage` (decimal string) - Carbohydrate percentage
- `fiber_percentage` (decimal string) - Fiber percentage
- `moisture_percentage` (decimal string) - Moisture percentage
- `serving_size` (string) - Serving size description (e.g., "1 cup")
- `servings_per_container` (number) - Number of servings per container

### Price Format
All prices are returned as decimal strings (e.g., `"12.99"`) to maintain precision.

### Date Format
All timestamps use ISO 8601 format in UTC (e.g., `"2024-01-15T10:30:00Z"`).

---

## Rate Limiting and Performance

- No rate limiting is currently implemented
- Recommended to implement client-side request throttling for production use
- All endpoints support concurrent requests
- Cart operations are atomic per user

---

## Development Notes

### Testing the API
- Use the provided curl examples
- Consider using Postman or similar tools for interactive testing
- The admin endpoints are essential for setting up test data

### Integration Tips
- Always check the health endpoint before making other requests
- Use the admin seed endpoint to populate test data
- Handle all HTTP status codes appropriately
- Implement proper error handling for network failures
- The checkout endpoint clears the cart automatically upon successful completion
- Payment method validation is performed server-side

### Performance Considerations
- Food listings can return large datasets; consider implementing pagination in your UI
- Cart operations are optimized for individual users
- Food filtering is optimized for better performance
- Checkout operations include inventory validation and may take longer for large carts
- Order IDs are generated using timestamps and user IDs for uniqueness