#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PET_SEED_FILE="$SCRIPT_DIR/seed.json"
PETFOOD_SEED_FILE="$SCRIPT_DIR/petfood-seed.json"

# Parse command line arguments
TABLE_TYPE="$1"  # Can be "pets", "petfood", "all", or a specific table name
SPECIFIC_TABLE="$2"  # Optional: specific table name when TABLE_TYPE is "pets" or "petfood"

# Function to check if seed files exist
check_seed_files() {
    local missing_files=()

    if [[ ! -f "$PET_SEED_FILE" ]]; then
        missing_files+=("$PET_SEED_FILE")
    fi

    if [[ ! -f "$PETFOOD_SEED_FILE" ]]; then
        missing_files+=("$PETFOOD_SEED_FILE")
    fi

    if [[ ${#missing_files[@]} -gt 0 ]]; then
        echo "Error: Seed files not found:"
        printf ' - %s\n' "${missing_files[@]}"
        exit 1
    fi
}

# Function to check AWS credentials
check_aws_credentials() {
    if ! aws sts get-caller-identity &>/dev/null; then
        echo "Error: Valid AWS credentials not found. Please configure AWS CLI."
        exit 1
    fi
}

# Function to get available tables
get_available_tables() {
    echo "Fetching DynamoDB tables..."
    TABLES=$(aws dynamodb list-tables --query 'TableNames' --output text)

    if [[ -z "$TABLES" ]]; then
        echo "No DynamoDB tables found in the current region."
        exit 1
    fi

    TABLE_ARRAY=($TABLES)
}

# Function to find tables by pattern (case-insensitive)
find_tables_by_pattern() {
    local pattern="$1"
    local found_tables=()

    for table in "${TABLE_ARRAY[@]}"; do
        # Convert both table name and pattern to lowercase for comparison
        local table_lower=$(echo "$table" | tr '[:upper:]' '[:lower:]')
        local pattern_lower=$(echo "$pattern" | tr '[:upper:]' '[:lower:]')
        if [[ "$table_lower" == *"$pattern_lower"* ]]; then
            found_tables+=("$table")
        fi
    done

    echo "${found_tables[@]}"
}

# Function to seed pet adoption table
seed_pet_table() {
    local table_name="$1"
    echo "Seeding pet adoption table: $table_name"

    # Read and process pet seed data
    local count=0
    while read -r item; do
        petid=$(echo "$item" | jq -r '.petid')
        echo "Inserting pet item with petid: $petid"

        # Convert JSON to DynamoDB format (all strings)
        dynamo_item=$(echo "$item" | jq 'with_entries(select(.value != null and .key != null)) | with_entries(.value = {S: (.value | tostring)})')

        aws dynamodb put-item \
            --table-name "$table_name" \
            --item "$dynamo_item"

        count=$((count + 1))
    done < <(jq -c '.[]' "$PET_SEED_FILE")

    echo "Successfully seeded $table_name with pet adoption data ($count items)"
}

# Function to seed petfood table
seed_petfood_table() {
    local table_name="$1"
    echo "Seeding petfood table: $table_name"

    # Read and process petfood seed data
    local count=0
    while read -r item; do
        food_id=$(echo "$item" | jq -r '.id')
        food_name=$(echo "$item" | jq -r '.name')
        echo "Inserting food item: $food_id - $food_name"

        # Convert JSON to DynamoDB format with proper types
        dynamo_item=$(echo "$item" | jq '
            with_entries(select(.value != null and .key != null)) |
            with_entries(
                if (.key == "ingredients" and (.value | type) == "array") then
                    .value = {SS: .value}
                elif (.key == "nutritional_info" and (.value | type) == "object") then
                    .value = {M: (.value | with_entries(.value = {S: .value}))}
                elif (.value | type) == "number" then
                    .value = {N: (.value | tostring)}
                else
                    .value = {S: (.value | tostring)}
                end
            )
        ')

        aws dynamodb put-item \
            --table-name "$table_name" \
            --item "$dynamo_item"

        count=$((count + 1))
    done < <(jq -c '.[]' "$PETFOOD_SEED_FILE")

    echo "Successfully seeded $table_name with petfood data ($count items)"
}

# Function for interactive mode
interactive_mode() {
    get_available_tables

    # Find pet adoption and petfood tables
    local pet_tables=($(find_tables_by_pattern "Petadoption"))
    local petfood_tables=($(find_tables_by_pattern "petfood"))

    echo ""
    echo "Available seeding options:"
    echo "1) Seed both pet adoption and petfood tables"
    echo "2) Seed pet adoption table only"
    echo "3) Seed petfood table only"
    echo "4) Select specific table manually"
    echo ""

    read -p "Select an option (1-4): " -n 1 -r choice
    echo ""

    case $choice in
        1)
            echo "Seeding both pet adoption and petfood tables..."

            # Seed pet adoption tables
            if [[ ${#pet_tables[@]} -gt 0 ]]; then
                for table in "${pet_tables[@]}"; do
                    seed_pet_table "$table"
                done
            else
                echo "Warning: No pet adoption tables found (pattern: *Petadoption*)"
            fi

            # Seed petfood tables
            if [[ ${#petfood_tables[@]} -gt 0 ]]; then
                for table in "${petfood_tables[@]}"; do
                    seed_petfood_table "$table"
                done
            else
                echo "Warning: No petfood tables found (pattern: *PetFoods*)"
            fi
            ;;
        2)
            if [[ ${#pet_tables[@]} -eq 0 ]]; then
                echo "No pet adoption tables found (pattern: *Petadoption*)"
                exit 1
            elif [[ ${#pet_tables[@]} -eq 1 ]]; then
                seed_pet_table "${pet_tables[0]}"
            else
                echo "Multiple pet adoption tables found:"
                select table in "${pet_tables[@]}"; do
                    if [[ -n "$table" ]]; then
                        seed_pet_table "$table"
                        break
                    fi
                done
            fi
            ;;
        3)
            if [[ ${#petfood_tables[@]} -eq 0 ]]; then
                echo "No petfood tables found (pattern: *petfood*)"
                exit 1
            elif [[ ${#petfood_tables[@]} -eq 1 ]]; then
                seed_petfood_table "${petfood_tables[0]}"
            else
                echo "Multiple petfood tables found:"
                select table in "${petfood_tables[@]}"; do
                    if [[ -n "$table" ]]; then
                        seed_petfood_table "$table"
                        break
                    fi
                done
            fi
            ;;
        4)
            echo "Available DynamoDB tables:"
            select table in "${TABLE_ARRAY[@]}"; do
                if [[ -n "$table" ]]; then
                    # Determine table type by name pattern
                    if [[ "$table" == *"petfood"* ]]; then
                        seed_petfood_table "$table"
                    else
                        seed_pet_table "$table"
                    fi
                    break
                else
                    echo "Invalid selection. Please try again."
                fi
            done
            ;;
        *)
            echo "Invalid selection. Exiting."
            exit 1
            ;;
    esac
}

# Main script logic
main() {
    check_seed_files
    check_aws_credentials

    # Show usage if no arguments provided
    if [[ $# -eq 0 ]]; then
        echo "Usage: $0 [pets|petfood|all|<table_name>] [specific_table_name]"
        echo ""
        echo "Examples:"
        echo "  $0                           # Interactive mode"
        echo "  $0 all                       # Seed both pets and petfood tables"
        echo "  $0 pets                      # Seed all pet adoption tables"
        echo "  $0 petfood                   # Seed all petfood tables"
        echo "  $0 pets MyPetTable           # Seed specific pet table"
        echo "  $0 petfood MyPetfoodTable    # Seed specific petfood table"
        echo "  $0 MySpecificTable           # Seed specific table (auto-detect type)"
        echo ""
        interactive_mode
        return
    fi

    get_available_tables

    case "$TABLE_TYPE" in
        "all")
            echo "Seeding all pet adoption and petfood tables..."
            local pet_tables=($(find_tables_by_pattern "Petadoption"))
            local petfood_tables=($(find_tables_by_pattern "petfood"))

            for table in "${pet_tables[@]}"; do
                seed_pet_table "$table"
            done

            for table in "${petfood_tables[@]}"; do
                seed_petfood_table "$table"
            done
            ;;
        "pets")
            if [[ -n "$SPECIFIC_TABLE" ]]; then
                seed_pet_table "$SPECIFIC_TABLE"
            else
                local pet_tables=($(find_tables_by_pattern "Petadoption"))
                if [[ ${#pet_tables[@]} -eq 0 ]]; then
                    echo "No pet adoption tables found (pattern: *Petadoption*)"
                    exit 1
                fi
                for table in "${pet_tables[@]}"; do
                    seed_pet_table "$table"
                done
            fi
            ;;
        "petfood")
            if [[ -n "$SPECIFIC_TABLE" ]]; then
                seed_petfood_table "$SPECIFIC_TABLE"
            else
                local petfood_tables=($(find_tables_by_pattern "PetFoods"))
                if [[ ${#petfood_tables[@]} -eq 0 ]]; then
                    echo "No petfood tables found (pattern: *PetFoods*)"
                    exit 1
                fi
                for table in "${petfood_tables[@]}"; do
                    seed_petfood_table "$table"
                done
            fi
            ;;
        *)
            # Treat as specific table name
            local table_name="$TABLE_TYPE"
            echo "Seeding specific table: $table_name"

            # Auto-detect table type by name pattern
            if [[ "$table_name" == *"petfood"* ]]; then
                seed_petfood_table "$table_name"
            else
                seed_pet_table "$table_name"
            fi
            ;;
    esac
}

# Run the main function with all arguments
main "$@"
