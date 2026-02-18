#!/bin/bash
# Optimize Queries - Creates performance indexes on CustomerOrders table based on execution plan analysis.
# Adds three indexes (customerid+orderdate, orderdate, status+orderdate) to improve query performance.

# Get environment variables
PETSTORE_PARAM_PREFIX=${PETSTORE_PARAM_PREFIX:-}
RDS_SECRET_ARN_NAME=${RDS_SECRET_ARN_NAME:-}

# Function to retrieve database credentials from AWS Secrets Manager
get_db_credentials() {
    # Check if AWS CLI is installed
    if ! command -v aws > /dev/null 2>&1; then
        echo "Error: AWS CLI is not installed. Please install it first."
        exit 1
    fi

    # Check if required environment variables are set
    if [ -z "$PETSTORE_PARAM_PREFIX" ] || [ -z "$RDS_SECRET_ARN_NAME" ]; then
        echo "Error: Required environment variables not set"
        echo "PETSTORE_PARAM_PREFIX: ${PETSTORE_PARAM_PREFIX:-not set}"
        echo "RDS_SECRET_ARN_NAME: ${RDS_SECRET_ARN_NAME:-not set}"
        exit 1
    fi

    # Concatenate to form Parameter Store name
    PARAM_STORE_NAME="${PETSTORE_PARAM_PREFIX}/${RDS_SECRET_ARN_NAME}"

    # Get the Secrets Manager ARN from Parameter Store
    SECRET_ARN=$(aws ssm get-parameter \
        --name "$PARAM_STORE_NAME" \
        --query 'Parameter.Value' \
        --output text 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$SECRET_ARN" ]; then
        echo "Error: Failed to retrieve parameter '$PARAM_STORE_NAME' from Parameter Store"
        exit 1
    fi

    # Retrieve secret from AWS Secrets Manager using the ARN
    SECRET_JSON=$(aws secretsmanager get-secret-value \
        --secret-id "$SECRET_ARN" \
        --query SecretString \
        --output text 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$SECRET_JSON" ]; then
        echo "Error: Failed to retrieve secret '$SECRET_ARN' from AWS Secrets Manager"
        exit 1
    fi

    # Parse JSON and extract database connection details
    export PGHOST=$(echo "$SECRET_JSON" | jq -r '.host // empty')
    export PGPORT=$(echo "$SECRET_JSON" | jq -r '.port // "5432"')
    export PGDATABASE=$(echo "$SECRET_JSON" | jq -r '.dbname // empty')
    export PGUSER=$(echo "$SECRET_JSON" | jq -r '.username // empty')
    export PGPASSWORD=$(echo "$SECRET_JSON" | jq -r '.password // empty')

    # Validate required fields
    if [ -z "$PGHOST" ] || [ -z "$PGDATABASE" ] || [ -z "$PGUSER" ] || [ -z "$PGPASSWORD" ]; then
        echo "Error: Missing required database connection details in secret"
        exit 1
    fi
}

# Check if jq is installed
if ! command -v jq > /dev/null 2>&1; then
    echo "Error: jq is not installed. Please install it first."
    exit 1
fi

# Retrieve database credentials
get_db_credentials

echo "Creating performance indexes on CustomerOrders table..."
echo ""

START_TIME=$(date +%s)
psql -c "CREATE INDEX IF NOT EXISTS idx_customerorders_customerid_orderdate ON CustomerOrders(customerid, orderdate DESC);" > /dev/null 2>&1
echo "Index 1: idx_customerorders_customerid_orderdate created"

psql -c "CREATE INDEX IF NOT EXISTS idx_customerorders_orderdate ON CustomerOrders(orderdate);" > /dev/null 2>&1
echo "Index 2: idx_customerorders_orderdate created"

psql -c "CREATE INDEX IF NOT EXISTS idx_customerorders_status_orderdate ON CustomerOrders(status, orderdate);" > /dev/null 2>&1
echo "Index 3: idx_customerorders_status_orderdate created"

psql -c "ANALYZE CustomerOrders;" > /dev/null 2>&1

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "Optimization complete! (${DURATION}s)"
