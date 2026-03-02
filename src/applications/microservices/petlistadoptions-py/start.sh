#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# Pet List Adoptions Service Startup Script

echo "Starting Pet List Adoptions Service..."

# Set default values
export PORT=${PORT:-8080}

# Check if running in Docker/ECS
if [ -f /.dockerenv ] || [ -n "$ECS_CONTAINER_METADATA_URI" ]; then
    echo "Running in containerized environment (Docker/ECS)..."
    echo "Port: $PORT"
    echo "PYTHONPATH: ${PYTHONPATH:-not set}"
    echo "Application Signals: ${OTEL_AWS_APPLICATION_SIGNALS_ENABLED:-not set}"

    # Wait for any dependencies if needed
    if [ -n "$WAIT_FOR_DB" ]; then
        echo "Waiting for database to be ready..."
        sleep 10
    fi

    # Don't use --workers or opentelemetry-instrument wrapper
    # ADOT Python auto-instrumentation via PYTHONPATH handles it automatically
    exec uvicorn app:app --host 0.0.0.0 --port $PORT
else
    echo "Running in development mode..."
    exec uvicorn app:app --reload --host 0.0.0.0 --port $PORT
fi