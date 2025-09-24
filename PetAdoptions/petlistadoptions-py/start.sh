#!/bin/bash

# Pet List Adoptions Service Startup Script
# Note: Running as root for port 80 access

echo "Starting Pet List Adoptions Service..."

# Set default values
export PORT=${PORT:-80}
export WORKERS=${WORKERS:-4}

# Check if running in Docker/ECS
if [ -f /.dockerenv ] || [ -n "$ECS_CONTAINER_METADATA_URI" ]; then
    echo "Running in containerized environment (Docker/ECS)..."
    echo "Port: $PORT"
    echo "Workers: $WORKERS"
    
    # Wait for any dependencies if needed
    if [ -n "$WAIT_FOR_DB" ]; then
        echo "Waiting for database to be ready..."
        sleep 10
    fi
    
    exec uvicorn app:app --host 0.0.0.0 --port $PORT --workers $WORKERS
else
    echo "Running in development mode..."
    exec uvicorn app:app --reload --host 0.0.0.0 --port $PORT
fi 