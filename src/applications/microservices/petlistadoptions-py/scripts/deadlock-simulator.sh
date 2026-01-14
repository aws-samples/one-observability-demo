#!/bin/bash

# Configuration
CLOUDFORMATION_LOGICAL_ID="${CLOUDFORMATION_LOGICAL_ID:-DatabaseSecret3B817195}"

# Function to find secret by CloudFormation logical ID tag
find_secret_by_tag() {
    # echo "Searching for secret with CloudFormation logical ID: $CLOUDFORMATION_LOGICAL_ID..." >&2
    
    # List all secrets and filter by the CloudFormation logical ID tag
    SECRET_ARN=$(aws secretsmanager list-secrets \
        --query "SecretList[?Tags[?Key=='aws:cloudformation:logical-id' && Value=='$CLOUDFORMATION_LOGICAL_ID']].ARN" \
        --output text 2>/dev/null)
    
    # echo "Found secret: $SECRET_ARN" >&2
    echo "$SECRET_ARN"
}

# Function to retrieve database credentials from AWS Secrets Manager
get_db_credentials() {
    # echo "Retrieving database credentials from AWS Secrets Manager..."
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        echo "Error: AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Find the secret by CloudFormation logical ID tag
    SECRET_ARN=$(find_secret_by_tag)
    # echo $SECRET_ARN
    
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
    export PGHOST=$(echo "$SECRET_JSON" | jq -r '.host // .endpoint // empty')
    export PGPORT=$(echo "$SECRET_JSON" | jq -r '.port // "5432"')
    export PGDATABASE=$(echo "$SECRET_JSON" | jq -r '.dbname // .database // empty')
    export PGUSER=$(echo "$SECRET_JSON" | jq -r '.username // .user // empty')
    export PGPASSWORD=$(echo "$SECRET_JSON" | jq -r '.password // empty')
    
    # Validate required fields
    if [ -z "$PGHOST" ] || [ -z "$PGDATABASE" ] || [ -z "$PGUSER" ] || [ -z "$PGPASSWORD" ]; then
        echo "Error: Missing required database connection details in secret"
        echo "Expected JSON format:"
        echo '{'
        echo '  "host": "your-aurora-endpoint.cluster-xxx.region.rds.amazonaws.com",'
        echo '  "port": "5432",'
        echo '  "dbname": "your-database-name",'
        echo '  "username": "your-username",'
        echo '  "password": "your-password"'
        echo '}'
        exit 1
    fi
    
    # echo "Successfully retrieved database credentials"
    # echo "  Host: $PGHOST"
    # echo "  Port: $PGPORT"
    # echo "  Database: $PGDATABASE"
    # echo "  User: $PGUSER"
    # echo ""
}

# Check if jq is installed (required for JSON parsing)
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Please install it first."
    echo "On Amazon Linux/RHEL: sudo yum install jq"
    echo "On Ubuntu/Debian: sudo apt-get install jq"
    echo "On macOS: brew install jq"
    exit 1
fi

# Retrieve database credentials from AWS Secrets Manager
get_db_credentials

# Initialize deadlock counter
DEADLOCK_COUNTER=0

CYCLES=20
DELAY=1
CONCURRENT_SESSIONS=4

# echo "Starting deadlock simulation"
# echo "   Cycles: $CYCLES"
# echo "   Concurrent sessions per cycle: $CONCURRENT_SESSIONS"
# echo "   Delay: $DELAY seconds"
# echo ""

# Setup table with more rows
psql -c "DROP TABLE IF EXISTS orders;" > /dev/null 2>&1
psql -c "CREATE TABLE orders (id SERIAL PRIMARY KEY, value INTEGER);" > /dev/null 2>&1
psql -c "INSERT INTO orders (value) SELECT generate_series(1, 10);" > /dev/null 2>&1

# Function to create a deadlock-prone transaction
run_transaction() {
    local session_id=$1
    local row1=$2
    local row2=$3
    
    psql -c "BEGIN; 
             UPDATE orders SET value = value + 1 WHERE id = $row1; 
             SELECT pg_sleep(0.3); 
             UPDATE orders SET value = value + 1 WHERE id = $row2; 
             COMMIT;" > /tmp/session${session_id}.log 2>&1
    
    if grep -qi "deadlock" /tmp/session${session_id}.log; then
        DEADLOCK_COUNTER=$((DEADLOCK_COUNTER + 1))
        echo "Deadlock #$DEADLOCK_COUNTER: detected in Session $session_id !!!"
    fi
}

# Run deadlock cycles
for i in $(seq 1 $CYCLES); do
    # echo "========== Cycle $i/$CYCLES =========="
    
    # Start multiple concurrent sessions with conflicting lock orders
    run_transaction 1 1 2 &
    run_transaction 2 2 1 &
    run_transaction 3 3 4 &
    run_transaction 4 4 3 &
    
    # Wait for all sessions
    wait
    
    # echo "Cycle $i completed"
    
    if [ $i -lt $CYCLES ]; then
        # echo "Waiting $DELAY seconds before next cycle..."
        sleep $DELAY
        # echo ""
    fi
done

echo "=========================================="
echo "All cycles completed!"
echo "=========================================="
echo ""
echo "Checking for deadlock count in logs..."
DEADLOCK_COUNT=$(grep -i "deadlock detected" /tmp/session*.log 2>/dev/null | wc -l)
echo "Total deadlocks detected: $DEADLOCK_COUNT"
echo ""
echo "Check CloudWatch Metrics for 'Deadlocks' in 5-10 minutes"
echo "Metric namespace: AWS/RDS"
echo "Metric name: Deadlocks"
