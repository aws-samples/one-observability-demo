#!/bin/bash
# Unique Constraint Violation Simulator - Generates PostgreSQL error 23505 by attempting duplicate email inserts.
# Creates temporary CustomerContacts table and runs 20 cycles of duplicate insert attempts for error monitoring.

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

# Initialize violation counter file
rm -f /tmp/unique_violation_counter.txt
touch /tmp/unique_violation_counter.txt

# Configuration
CYCLES=${CYCLES:-2}
DELAY=${DELAY:-1}

# echo "Starting unique constraint violation simulation"
# echo "   Cycles: $CYCLES"
# echo "   Delay: $DELAY seconds"
# echo ""

# Setup table with unique constraint
psql -c "DROP TABLE IF EXISTS CustomerContacts;" > /dev/null 2>&1
psql -c "CREATE TABLE CustomerContacts (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE, created_at TIMESTAMP DEFAULT NOW());" > /dev/null 2>&1
psql -c "INSERT INTO CustomerContacts (email) VALUES ('user1@example.com');" > /dev/null 2>&1

# Function to attempt duplicate insert
attempt_duplicate_insert() {
    local cycle_num=$1
    local attempt_id=$2
    
    # Try to insert duplicate email (will violate unique constraint)
    # Using only email field so id auto-increments, forcing violation on email constraint
    psql -c "INSERT INTO CustomerContacts (email) VALUES ('user1@example.com');" > /tmp/violation_${cycle_num}_${attempt_id}.log 2>&1
    
    # Check for unique violation error (23505)
    if grep -qi "unique constraint\|duplicate key\|23505" /tmp/violation_${cycle_num}_${attempt_id}.log; then
        echo "1" >> /tmp/unique_violation_counter.txt
        CURRENT_COUNT=$(wc -l < /tmp/unique_violation_counter.txt 2>/dev/null || echo "0")
        echo "Unique violation #$CURRENT_COUNT: detected in Cycle $cycle_num, Attempt $attempt_id"
    fi
}

# Run violation cycles
for i in $(seq 1 $CYCLES); do
    # echo "========== Cycle $i/$CYCLES =========="
    
    # Attempt multiple duplicate inserts
    attempt_duplicate_insert $i 1
    attempt_duplicate_insert $i 2
    
    # echo "Cycle $i completed"
    
    if [ $i -lt $CYCLES ]; then
        # echo "Waiting $DELAY seconds before next cycle..."
        sleep $DELAY
    fi
done

echo "=========================================="
echo "All cycles completed!"
echo "=========================================="
echo ""
echo "Checking for unique violation count in logs..."
VIOLATION_COUNT=$(grep -i "unique constraint\|duplicate key" /tmp/violation_*.log 2>/dev/null | wc -l)
echo "Total unique violations detected: $VIOLATION_COUNT"
echo ""
echo "Check CloudWatch Logs for unique constraint violations"
echo "Log group: /aws/rds/cluster/your-cluster-name/postgresql"
echo "Search for: 'duplicate key' OR 'customercontacts_email_key'"

# Cleanup: Drop the temporary table
psql -c "DROP TABLE IF EXISTS CustomerContacts;" > /dev/null 2>&1
