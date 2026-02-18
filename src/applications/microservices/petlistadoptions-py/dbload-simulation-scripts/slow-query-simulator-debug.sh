#!/bin/bash
# Slow Query Simulator (Debug Version) - Same as slow-query-simulator.sh with verbose timing and progress output.
# Shows execution times for each query type and cycle progress during performance testing.

# Get environment variables
PETSTORE_PARAM_PREFIX=${PETSTORE_PARAM_PREFIX:-}
RDS_SECRET_ARN_NAME=${RDS_SECRET_ARN_NAME:-}

# Function to retrieve database credentials from AWS Secrets Manager
get_db_credentials() {
    echo "Retrieving database credentials from AWS Secrets Manager..."

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
    echo "Parameter Store name: $PARAM_STORE_NAME"

    # Get the Secrets Manager ARN from Parameter Store
    echo "Retrieving Secrets Manager ARN from Parameter Store..."
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

    echo "Secrets Manager ARN: $SECRET_ARN"

    # Retrieve secret from AWS Secrets Manager using the ARN
    echo "Retrieving secret from Secrets Manager..."
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

    echo "Successfully retrieved database credentials"
    echo "  Host: $PGHOST"
    echo "  Port: $PGPORT"
    echo "  Database: $PGDATABASE"
    echo "  User: $PGUSER"
    echo ""
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
CYCLES=${CYCLES:-50}
DELAY=${DELAY:-2}

# Check if optimization indexes exist
INDEX_COUNT=$(psql -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'customerorders' AND indexname LIKE 'idx_customerorders_%';" 2>/dev/null | tr -d ' ')

if [ "$INDEX_COUNT" -ge 3 ]; then
    echo "Starting optimized query simulation (AFTER optimization)"
    echo "   Cycles: $CYCLES"
    echo "   Delay: $DELAY seconds"
    echo ""
    echo "This will demonstrate improved performance with indexes:"
    echo "  - Fast index lookups instead of full table scans"
    echo "  - Reduced CPU and I/O consumption"
    echo "  - 10-100x faster query execution"
    QUERY_STATE="optimized"
else
    echo "Starting slow query simulation (BEFORE optimization)"
    echo "   Cycles: $CYCLES"
    echo "   Delay: $DELAY seconds"
    echo ""
    echo "This will generate slow queries to demonstrate:"
    echo "  - Full table scans"
    echo "  - Missing index performance issues"
    echo "  - High CPU and I/O wait events"
    QUERY_STATE="unoptimized"
fi
echo ""

# Run slow queries without indexes
for i in $(seq 1 $CYCLES); do
    echo "========== Cycle $i/$CYCLES =========="

    CUSTOMER_ID=$((RANDOM % 1000 + 1))
    START_TIME=$(date +%s%N)
    psql -c "SELECT * FROM CustomerOrders WHERE customerid = $CUSTOMER_ID ORDER BY orderdate DESC LIMIT 10;" > /dev/null 2>&1
    END_TIME=$(date +%s%N)
    DURATION=$(( (END_TIME - START_TIME) / 1000000 ))
    if [ "$QUERY_STATE" = "optimized" ]; then
        echo "Query 1: Searching for customer $CUSTOMER_ID orders (using index on customerid)...Completed in ${DURATION}ms"
    else
        echo "Query 1: Searching for customer $CUSTOMER_ID orders (no index on customerid)...Completed in ${DURATION}ms"
    fi

    START_TIME=$(date +%s%N)
    psql -c "SELECT customerid, COUNT(*), SUM(amount) FROM CustomerOrders WHERE orderdate > '2024-01-01' GROUP BY customerid HAVING COUNT(*) > 5;" > /dev/null 2>&1
    END_TIME=$(date +%s%N)
    DURATION=$(( (END_TIME - START_TIME) / 1000000 ))
    if [ "$QUERY_STATE" = "optimized" ]; then
        echo "Query 2: Aggregating orders by customer (using index on orderdate)...Completed in ${DURATION}ms"
    else
        echo "Query 2: Aggregating orders by customer (no table optimization)...Completed in ${DURATION}ms"
    fi

    START_TIME=$(date +%s%N)
    psql -c "SELECT * FROM CustomerOrders WHERE orderdate BETWEEN '2024-06-01' AND '2024-06-30' AND status = 'pending';" > /dev/null 2>&1
    END_TIME=$(date +%s%N)
    DURATION=$(( (END_TIME - START_TIME) / 1000000 ))
    if [ "$QUERY_STATE" = "optimized" ]; then
        echo "Query 3: Date range scan with status filter (using composite index)...Completed in ${DURATION}ms"
    else
        echo "Query 3: Date range scan with status filter (no table optimization)...Completed in ${DURATION}ms"
    fi

    echo "Cycle $i completed"
    echo ""

    if [ $i -lt $CYCLES ]; then
        echo "Waiting $DELAY seconds before next cycle..."
        sleep $DELAY
        echo ""
    fi
done

echo ""
echo "=========================================="
if [ "$QUERY_STATE" = "optimized" ]; then
    echo "Optimized query simulation completed!"
else
    echo "Slow query simulation completed!"
fi
echo "=========================================="
