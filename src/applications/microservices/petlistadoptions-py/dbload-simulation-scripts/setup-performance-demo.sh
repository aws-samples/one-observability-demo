#!/bin/bash
# Setup Performance Simulation - Loads CustomerOrders table data and prepares database for performance optimization demonstration.
# Removes existing optimization indexes to start with unoptimized state for before/after comparison.

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

echo "Setting up performance simulation..."
echo ""

# Configuration
NUM_RECORDS=${NUM_RECORDS:-1000000}  # Default: 1 million records
BATCH_SIZE=${BATCH_SIZE:-10000}      # Insert in batches for performance

echo "Generating $NUM_RECORDS records in CustomerOrders table..."

# Create table
psql << 'EOF' > /dev/null 2>&1
DROP TABLE IF EXISTS CustomerOrders CASCADE;

CREATE TABLE CustomerOrders (
    orderid SERIAL PRIMARY KEY,
    customerid INTEGER,
    orderdate DATE,
    amount NUMERIC(10,2),
    status VARCHAR(20)
);

CREATE INDEX customer_id_order_date_idx ON CustomerOrders USING btree (customerid, orderdate);
EOF

if [ $? -ne 0 ]; then
    echo "Error: Failed to create table"
    exit 1
fi

# Generate data
START_TIME=$(date +%s)
TOTAL_BATCHES=$(( (NUM_RECORDS + BATCH_SIZE - 1) / BATCH_SIZE ))

for batch in $(seq 1 $TOTAL_BATCHES); do
    START_ID=$(( (batch - 1) * BATCH_SIZE + 1 ))
    END_ID=$(( batch * BATCH_SIZE ))

    if [ $END_ID -gt $NUM_RECORDS ]; then
        END_ID=$NUM_RECORDS
    fi

    RECORDS_IN_BATCH=$(( END_ID - START_ID + 1 ))

    psql -c "
    INSERT INTO CustomerOrders (customerid, orderdate, amount, status)
    SELECT
        10000 + (random() * 10000)::int AS customerid,
        '2024-01-01'::date + (random() * 365)::int AS orderdate,
        (random() * 1000)::numeric(10,2) AS amount,
        CASE (random() * 4)::int
            WHEN 0 THEN 'Pending'
            WHEN 1 THEN 'Shipped'
            WHEN 2 THEN 'Delivered'
            WHEN 3 THEN 'Cancelled'
            ELSE 'Pending'
        END AS status
    FROM generate_series(1, $RECORDS_IN_BATCH);
    " > /dev/null 2>&1

    if [ $? -ne 0 ]; then
        echo "Error: Failed to insert batch $batch"
        exit 1
    fi

    # Progress indicator every 10%
    if [ $((batch % (TOTAL_BATCHES / 10))) -eq 0 ] || [ $batch -eq $TOTAL_BATCHES ]; then
        PROGRESS=$(( batch * 100 / TOTAL_BATCHES ))
        RECORDS_INSERTED=$(( batch * BATCH_SIZE ))
        if [ $RECORDS_INSERTED -gt $NUM_RECORDS ]; then
            RECORDS_INSERTED=$NUM_RECORDS
        fi

        echo "Progress: $PROGRESS% ($RECORDS_INSERTED / $NUM_RECORDS records)"
    fi
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

# Remove optimization indexes
psql -c "DROP INDEX IF EXISTS idx_customerorders_customerid_orderdate;" > /dev/null 2>&1
psql -c "DROP INDEX IF EXISTS idx_customerorders_orderdate;" > /dev/null 2>&1
psql -c "DROP INDEX IF EXISTS idx_customerorders_status_orderdate;" > /dev/null 2>&1

# Update statistics
psql -c "ANALYZE CustomerOrders;" > /dev/null 2>&1

ROW_COUNT=$(psql -t -c "SELECT COUNT(*) FROM CustomerOrders;" | tr -d ' ')

echo ""
echo "Setup complete! Generated $ROW_COUNT records in ${MINUTES}m ${SECONDS}s"
