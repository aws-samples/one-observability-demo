# Database Load Simulation Scripts

Scripts to simulate database load, deadlock, performance issues, and error conditions for demonstrating observability and monitoring in CloudWatch DBInsights.

## Scripts Overview

### Error Simulation Scripts
- `deadlock-simulator.sh` - Generates database deadlocks through concurrent conflicting transactions (20 cycles)
- `unique-violation-simulator.sh` - Triggers unique constraint violations by inserting duplicate records (2 cycles)
- `slow-query-simulator.sh` - Generates slow database queries without indexes to demonstrate performance issues (50 cycles)

### Performance Demo Scripts
- `setup-performance-demo.sh` - Loads CustomerOrders table with 1M records and removes optimization indexes
- `optimize-queries.sh` - Creates performance indexes on CustomerOrders table to improve query performance
- `cleanup-performance-demo.sh` - Drops CustomerOrders table and all associated indexes

### Debug Versions
- `deadlock-simulator-debug.sh` - Verbose version of deadlock simulator with detailed execution steps
- `unique-violation-simulator-debug.sh` - Verbose version of unique violation simulator with error details
- `slow-query-simulator-debug.sh` - Verbose version of slow query simulator with timing information

## Prerequisites

- AWS CLI configured with appropriate permissions
- `jq` for JSON parsing
- PostgreSQL client (`psql`)
- Environment variables: `PETSTORE_PARAM_PREFIX` and `RDS_SECRET_ARN_NAME`

## Usage

### Basic Usage

```bash
export PETSTORE_PARAM_PREFIX="your-prefix"
export RDS_SECRET_ARN_NAME="your-secret-name"

# Run error simulations
./deadlock-simulator.sh
./unique-violation-simulator.sh
./slow-query-simulator.sh
```

### Performance Demo Workflow

```bash
# 1. Setup: Create table with 1M records (unoptimized)
./setup-performance-demo.sh

# 2. Run slow queries to demonstrate performance issues
./slow-query-simulator.sh

# 3. Optimize: Add indexes
./optimize-queries.sh

# 4. Run queries again to show improvement
./slow-query-simulator.sh

# 5. Cleanup when done
./cleanup-performance-demo.sh
```

### Debug Mode

For detailed output and troubleshooting, use the debug versions:

```bash
./deadlock-simulator-debug.sh
./unique-violation-simulator-debug.sh
./slow-query-simulator-debug.sh
```

## Script Details

### deadlock-simulator.sh
- Creates temporary `CustomerOrders` table with 10 rows
- Runs 20 cycles of concurrent transactions with conflicting lock orders
- 4 concurrent sessions per cycle
- Automatically cleans up temporary table
- Reports total deadlocks detected
- Check CloudWatch Metrics for 'Deadlocks' in AWS/RDS namespace

### unique-violation-simulator.sh
- Creates temporary `CustomerContacts` table with unique email constraint
- Runs 2 cycles with 2 duplicate insert attempts each
- Generates PostgreSQL error 23505 (unique constraint violation)
- Automatically cleans up temporary table
- Check CloudWatch Logs for 'duplicate key' or 'customercontacts_email_key'

### slow-query-simulator.sh
- Runs 50 cycles of unoptimized queries (configurable via `CYCLES` env var)
- Three query types: customer lookup, aggregation, date range scan
- Detects if optimization indexes exist and adjusts behavior
- 2-second delay between cycles (configurable via `DELAY` env var)
- Demonstrates full table scans and missing index performance issues

### setup-performance-demo.sh
- Creates `CustomerOrders` table with realistic schema
- Generates 1M records by default (configurable via `NUM_RECORDS` env var)
- Inserts data in batches of 10K for performance (configurable via `BATCH_SIZE` env var)
- Removes optimization indexes to start with unoptimized state
- Shows progress indicators during data generation

### optimize-queries.sh
- Creates three performance indexes:
  - `idx_customerorders_customerid_orderdate` - Composite index for customer lookups
  - `idx_customerorders_orderdate` - Index for date-based queries
  - `idx_customerorders_status_orderdate` - Composite index for status filtering
- Updates table statistics with ANALYZE
- Reports creation time

### cleanup-performance-demo.sh
- Drops `CustomerOrders` table and all associated indexes
- Checks if table exists before attempting cleanup
- Safe to run multiple times

## Configuration

Scripts support environment variables for customization:

```bash
# Database credentials (required)
export PETSTORE_PARAM_PREFIX="your-prefix"
export RDS_SECRET_ARN_NAME="your-secret-name"

# Performance demo configuration (optional)
export NUM_RECORDS=1000000    # Number of records to generate
export BATCH_SIZE=10000       # Batch size for inserts
export CYCLES=50              # Number of query cycles
export DELAY=2                # Delay between cycles in seconds
```

## Monitoring

After running simulations, check the following AWS services:

- **CloudWatch Metrics**: AWS/RDS namespace for deadlock counts
- **CloudWatch Logs**: RDS PostgreSQL logs for error details
- **Performance Insights**: Query performance and wait events
- **CloudWatch DBInsights**: Database performance analysis

Scripts automatically retrieve database credentials from AWS Secrets Manager via Parameter Store.
