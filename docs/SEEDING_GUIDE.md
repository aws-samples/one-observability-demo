# DynamoDB Seeding Guide

## Overview

The `seed-dynamodb.sh` script provides a comprehensive solution for seeding both pet adoption and petfood DynamoDB tables with sample data. It supports both interactive and non-interactive modes for flexible usage.

## Files

- **`seed-dynamodb.sh`** - Main seeding script (10KB)
- **`seed.json`** - Pet adoption sample data (4.3KB)
- **`petfood-seed.json`** - Petfood sample data (7KB)

## Petfood Sample Data

The `petfood-seed.json` contains 10 diverse food items with:

- **Pet Types**: Dogs, Cats
- **Food Types**: Dry food, Wet food, Treats
- **Brands**: PetNutrition Pro, PetDelicious, TreatTime, NaturalPet
- **Data Structure**:
  - Basic info (id, name, brand, price, description, image_url)
  - Pet/food type classification
  - Availability status
  - Ingredients array
  - Nutritional information object
  - Timestamps

## Usage Examples

### Interactive Mode
```bash
# Run without arguments to enter interactive mode
./src/cdk/scripts/seed-dynamodb.sh
```

Interactive mode provides a menu with options:
1. Seed both pet adoption and petfood tables
2. Seed pet adoption table only
3. Seed petfood table only
4. Select specific table manually

### Non-Interactive Mode

#### Seed All Tables
```bash
# Seed both pet adoption and petfood tables
./src/cdk/scripts/seed-dynamodb.sh all
```

#### Seed by Type
```bash
# Seed all pet adoption tables (pattern: *Petadoption*)
./src/cdk/scripts/seed-dynamodb.sh pets

# Seed all petfood tables (pattern: *petfood*)
./src/cdk/scripts/seed-dynamodb.sh petfood
```

#### Seed Specific Tables
```bash
# Seed specific pet adoption table
./src/cdk/scripts/seed-dynamodb.sh pets MyPetAdoptionTable

# Seed specific petfood table
./src/cdk/scripts/seed-dynamodb.sh petfood MyPetfoodTable

# Auto-detect table type by name
./src/cdk/scripts/seed-dynamodb.sh MySpecificTableName
```

## Features

### Automatic Table Discovery
- Scans DynamoDB for available tables
- Pattern-based matching for table types:
  - Pet adoption: `*Petadoption*`
  - Petfood: `*petfood*`

### Data Type Conversion
The script automatically converts JSON data to DynamoDB format:

#### Pet Data
- All values converted to strings (`{S: value}`)
- Handles null/empty value filtering

#### Petfood Data
- Strings: `{S: value}`
- Arrays (ingredients): `{SS: [values]}`
- Objects (nutritional_info): `{M: {key: {S: value}}}`

### Error Handling
- Validates AWS credentials
- Checks for required seed files
- Provides clear error messages
- Handles missing tables gracefully

### Validation Checks
- Confirms AWS CLI is configured
- Verifies seed files exist
- Validates table availability
- Reports seeding progress

## Data Structure Examples

### Pet Adoption Data (seed.json)
```json
{
  "petid": "P001",
  "petname": "Buddy",
  "petage": "2",
  "pettype": "dog",
  "breed": "Golden Retriever"
}
```

### Petfood Data (petfood-seed.json)
```json
{
  "id": "F001",
  "name": "Premium Dog Food - Adult",
  "brand": "PetNutrition Pro",
  "price": "24.99",
  "pet_type": "dog",
  "food_type": "dry",
  "ingredients": ["Chicken", "Rice", "Vegetables"],
  "nutritional_info": {
    "Protein": "28%",
    "Fat": "15%"
  }
}
```

## Prerequisites

1. **AWS CLI**: Configured with valid credentials
2. **Permissions**: DynamoDB table read/write access
3. **Dependencies**: `jq` for JSON processing
4. **Executability**: Script must be executable (`chmod +x`)

## Troubleshooting

### Common Issues

1. **AWS Credentials Not Found**
   ```
   Error: Valid AWS credentials not found. Please configure AWS CLI.
   ```
   Solution: Run `aws configure` or set environment variables

2. **Seed Files Missing**
   ```
   Error: Seed files not found: ./seed.json
   ```
   Solution: Ensure both `seed.json` and `petfood-seed.json` exist in script directory

3. **No Tables Found**
   ```
   No DynamoDB tables found in the current region.
   ```
   Solution: Verify region and deploy DynamoDB stacks first

4. **Table Pattern Not Found**
   ```
   No petfood tables found (pattern: *petfood*)
   ```
   Solution: Check table naming conventions match expected patterns

### Debug Information

The script provides verbose output including:
- Table discovery results
- Item insertion progress
- Final count of seeded items
- Error details with context

## Integration with CDK

This seeding script is designed to work with the One Observability Demo CDK infrastructure:

1. Deploy CDK stacks to create DynamoDB tables
2. Run seeding script to populate with sample data
3. Tables are ready for application testing

## Benefits

- **Comprehensive**: Seeds both pet adoption and petfood data
- **Flexible**: Interactive and non-interactive modes
- **Robust**: Error handling and validation
- **Efficient**: Batch processing with progress reporting
- **Maintainable**: Clear code structure and documentation
