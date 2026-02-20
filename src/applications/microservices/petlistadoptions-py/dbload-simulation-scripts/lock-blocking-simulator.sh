#!/bin/bash
# Lock Blocking Simulator - Generates blocking sessions for CloudWatch Performance Insights Lock Analysis.
# Creates scenarios where sessions hold locks while other sessions wait, demonstrating blocking objects and SQL.

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
        echo "Please ensure:"
        echo "  1. The parameter exists in Parameter Store"
        echo "  2. You have ssm:GetParameter permission"
        exit 1
    fi

    # Retrieve secret from AWS Secrets Manager using the ARN
    SECRET_JSON=$(aws secretsmanager get-secret-value \
        --secret-id "$SECRET_ARN" \
        --query SecretString \
        --output text 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$SECRET_JSON" ]; then
        echo "Error: Failed to retrieve secret '$SECRET_ARN' from AWS Secrets Manager"
        echo "Please ensure:"
        echo "  1. You have proper AWS credentials configured"
        echo "  2. You have secretsmanager:GetSecretValue permission"
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
        echo "Expected JSON format with keys: host, port, dbname, username, password"
        exit 1
    fi
}

# Check if jq is installed (required for JSON parsing)
if ! command -v jq > /dev/null 2>&1; then
    echo "Error: jq is not installed. Please install it first."
    echo "On Amazon Linux/RHEL: sudo yum install jq"
    echo "On Ubuntu/Debian: sudo apt-get install jq"
    echo "On macOS: brew install jq"
    exit 1
fi

# Retrieve database credentials from AWS Secrets Manager
get_db_credentials

# Configuration
CYCLES=${CYCLES:-10}
LOCK_DURATION=${LOCK_DURATION:-5}
DELAY=${DELAY:-2}

# Setup table
psql -c "DROP TABLE IF EXISTS InventoryItems;" > /dev/null 2>&1
psql -c "CREATE TABLE InventoryItems (id SERIAL PRIMARY KEY, product_name VARCHAR(255), quantity INTEGER, last_updated TIMESTAMP DEFAULT NOW());" > /dev/null 2>&1
psql -c "INSERT INTO InventoryItems (product_name, quantity) VALUES ('Widget A', 100), ('Widget B', 200), ('Widget C', 150), ('Widget D', 300), ('Widget E', 250);" > /dev/null 2>&1

# Function to create a blocking session (holds lock for extended period)
blocking_session() {
    local cycle_num=$1
    local row_id=$2

    # Start transaction and hold lock for LOCK_DURATION seconds
    psql > /tmp/blocking_session_${cycle_num}.log 2>&1 <<EOF
BEGIN;
UPDATE InventoryItems SET quantity = quantity + 1, last_updated = NOW() WHERE id = $row_id;
SELECT pg_sleep($LOCK_DURATION);
COMMIT;
EOF
}

# Function to create a blocked session (waits for lock)
blocked_session() {
    local cycle_num=$1
    local session_id=$2
    local row_id=$3

    # Try to update the same row (will be blocked)
    psql > /tmp/blocked_session_${cycle_num}_${session_id}.log 2>&1 <<EOF
SELECT product_name, quantity FROM InventoryItems WHERE id = $row_id FOR UPDATE;
UPDATE InventoryItems SET quantity = quantity - 1 WHERE id = $row_id;
EOF
}

# Run blocking cycles
echo "Running lock blocking simulation..."
for i in $(seq 1 $CYCLES); do
    # Alternate between different rows to create varied blocking scenarios
    ROW_ID=$((($i % 5) + 1))

    # Start blocking session (holds lock)
    blocking_session $i $ROW_ID &
    BLOCKING_PID=$!

    # Give blocking session time to acquire lock
    sleep 0.5

    # Start multiple blocked sessions (will wait for lock)
    blocked_session $i 1 $ROW_ID &
    blocked_session $i 2 $ROW_ID &
    blocked_session $i 3 $ROW_ID &

    # Wait for all sessions to complete
    wait

    # Show progress every 3 cycles
    if [ $((i % 3)) -eq 0 ]; then
        echo "Progress: Cycle $i/$CYCLES completed (3 blocked sessions per cycle)"
    fi

    if [ $i -lt $CYCLES ]; then
        sleep $DELAY
    fi
done

echo ""
echo "=========================================="
echo "All cycles completed!"
echo "=========================================="
echo ""
echo "Lock blocking simulation completed successfully"
echo "Total blocking scenarios executed: $((CYCLES * 3))"
echo ""

# Cleanup: Drop the temporary table
psql -c "DROP TABLE IF EXISTS InventoryItems;" > /dev/null 2>&1

echo "Check CloudWatch Database Insights for Lock Analysis:"
echo "  - Blocking Object: InventoryItems table"
echo "  - Blocking SQL: UPDATE InventoryItems SET quantity = quantity + 1, last_updated = NOW() WHERE id = X"
echo "  - Blocked SQL: SELECT product_name, quantity FROM InventoryItems WHERE id = X FOR UPDATE"
