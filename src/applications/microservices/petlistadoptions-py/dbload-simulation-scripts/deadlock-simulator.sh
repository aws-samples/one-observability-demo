#!/bin/bash
# Deadlock Simulator - Generates database deadlocks by running concurrent transactions with conflicting lock orders.
# Creates temporary CustomerOrders table and simulates 20 cycles of deadlock scenarios for CloudWatch monitoring.

# Get environment variables
PETSTORE_PARAM_PREFIX=${PETSTORE_PARAM_PREFIX:-}
RDS_SECRET_ARN_NAME=${RDS_SECRET_ARN_NAME:-}

# Function to retrieve database credentials from AWS Secrets Manager
get_db_credentials() {
    # echo "Retrieving database credentials from AWS Secrets Manager..."
    
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

# Initialize deadlock counter file
rm -f /tmp/deadlock_counter.txt
touch /tmp/deadlock_counter.txt

CYCLES=20
DELAY=1
CONCURRENT_SESSIONS=4

# echo "Starting deadlock simulation"
# echo "   Cycles: $CYCLES"
# echo "   Concurrent sessions per cycle: $CONCURRENT_SESSIONS"
# echo "   Delay: $DELAY seconds"
# echo ""

# Setup table with more rows
psql -c "DROP TABLE IF EXISTS CustomerOrders;" > /dev/null 2>&1
psql -c "CREATE TABLE CustomerOrders (id SERIAL PRIMARY KEY, value INTEGER);" > /dev/null 2>&1
psql -c "INSERT INTO CustomerOrders (value) SELECT generate_series(1, 10);" > /dev/null 2>&1

# Function to create a deadlock-prone transaction
run_transaction() {
    local cycle_num=$1
    local session_id=$2
    local row1=$3
    local row2=$4
    
    psql -c "BEGIN; 
             UPDATE CustomerOrders SET value = value + 1 WHERE id = $row1; 
             SELECT pg_sleep(0.3); 
             UPDATE CustomerOrders SET value = value + 1 WHERE id = $row2; 
             COMMIT;" > /tmp/session${session_id}.log 2>&1
    
    if grep -qi "deadlock" /tmp/session${session_id}.log; then
        # Write to a counter file instead of incrementing variable
        echo "1" >> /tmp/deadlock_counter.txt
    fi
}

# Run deadlock cycles
echo "Running deadlock simulation..."
for i in $(seq 1 $CYCLES); do
    # Start multiple concurrent sessions with conflicting lock orders
    run_transaction $i 1 1 2 &
    run_transaction $i 2 2 1 &
    run_transaction $i 3 3 4 &
    run_transaction $i 4 4 3 &
    
    # Wait for all sessions
    wait
    
    # Show progress every 5 cycles
    if [ $((i % 5)) -eq 0 ]; then
        CURRENT_COUNT=$(wc -l < /tmp/deadlock_counter.txt 2>/dev/null || echo "0")
        echo "Progress: Cycle $i/$CYCLES completed, $CURRENT_COUNT deadlocks detected so far"
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
DEADLOCK_COUNT=$(wc -l < /tmp/deadlock_counter.txt 2>/dev/null || echo "0")
echo "Total deadlocks detected: $DEADLOCK_COUNT"
echo ""

# Cleanup: Drop the temporary table
psql -c "DROP TABLE IF EXISTS CustomerOrders;" > /dev/null 2>&1

echo "Check CloudWatch Metrics for 'Deadlocks' in 5-10 minutes"
echo "Metric namespace: AWS/RDS"
echo "Metric name: Deadlocks"
