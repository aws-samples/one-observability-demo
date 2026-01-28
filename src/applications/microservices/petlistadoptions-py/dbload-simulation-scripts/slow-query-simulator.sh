#!/bin/bash
# Slow Query Simulator - Generates slow database queries without indexes to demonstrate performance issues.
# Runs 50 cycles of unoptimized queries on CustomerOrders table for CloudWatch DBInsights analysis.

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
CYCLES=${CYCLES:-50}
DELAY=${DELAY:-2}

# Check if optimization indexes exist
INDEX_COUNT=$(psql -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'customerorders' AND indexname LIKE 'idx_customerorders_%';" 2>/dev/null | tr -d ' ')

if [ "$INDEX_COUNT" -ge 3 ]; then
    echo "Starting optimized query simulation..."
    echo "Running $CYCLES cycles with indexes enabled"
    QUERY_STATE="optimized"
else
    echo "Starting slow query simulation..."
    echo "Running $CYCLES cycles of unoptimized queries"
    QUERY_STATE="unoptimized"
fi
echo ""

# Run slow queries without indexes
for i in $(seq 1 $CYCLES); do
    # Progress indicator every 10 cycles
    if [ $((i % 10)) -eq 0 ] || [ $i -eq 1 ]; then
        if [ "$QUERY_STATE" = "optimized" ]; then
            echo "Progress: Cycle $i/$CYCLES - Running queries with table optimization..."
        else
            echo "Progress: Cycle $i/$CYCLES - Simulating slow queries without table optimization..."
        fi
    fi
    
    # Slow query 1: Full table scan on CustomerOrders filtering by customerid
    psql -c "SELECT * FROM CustomerOrders WHERE customerid = $((RANDOM % 1000 + 1)) ORDER BY orderdate DESC LIMIT 10;" > /dev/null 2>&1
    
    # Slow query 2: Aggregation without index
    psql -c "SELECT customerid, COUNT(*), SUM(amount) FROM CustomerOrders WHERE orderdate > '2024-01-01' GROUP BY customerid HAVING COUNT(*) > 5;" > /dev/null 2>&1
    
    # Slow query 3: Range scan on date
    psql -c "SELECT * FROM CustomerOrders WHERE orderdate BETWEEN '2024-06-01' AND '2024-06-30' AND status = 'pending';" > /dev/null 2>&1
    
    if [ $i -lt $CYCLES ]; then
        sleep $DELAY
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
