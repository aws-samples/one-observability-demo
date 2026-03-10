# Seeding Data

The `seed-dynamodb.sh` script seeds both pet adoption and petfood DynamoDB tables with sample data. It supports interactive and non-interactive modes.

## Usage

### Interactive Mode

```bash
./src/cdk/scripts/seed-dynamodb.sh
```

Presents a menu:

1. Seed both pet adoption and petfood tables
2. Seed pet adoption table only
3. Seed petfood table only
4. Select specific table manually

### Non-Interactive Mode

```bash
# Seed all tables
./src/cdk/scripts/seed-dynamodb.sh all

# Seed by type
./src/cdk/scripts/seed-dynamodb.sh pets
./src/cdk/scripts/seed-dynamodb.sh petfood

# Seed specific table
./src/cdk/scripts/seed-dynamodb.sh pets MyPetAdoptionTable
```

## Prerequisites

- AWS CLI configured with valid credentials
- DynamoDB table read/write access
- `jq` installed
- CDK resources deployed first

## Data Structure

### Pet Adoption Data

```json
{
  "petid": "P001",
  "petname": "Buddy",
  "petage": "2",
  "pettype": "dog",
  "breed": "Golden Retriever"
}
```

### Petfood Data

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

## Features

- Automatic table discovery via pattern matching
- Automatic DynamoDB format conversion (strings, string sets, maps)
- Validation of AWS credentials and seed files
- Progress reporting during seeding
