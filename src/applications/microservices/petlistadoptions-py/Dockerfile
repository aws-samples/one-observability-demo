FROM public.ecr.aws/docker/library/python:3.13-slim as builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

#

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install awscli

# Copy application code
COPY . .

# Production stage
FROM public.ecr.aws/docker/library/python:3.13-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libpq5 \
    curl \
    jq \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY --from=builder /app .

# Make start script executable
RUN chmod +x start.sh
RUN chmod +x ./dbload-simulation-scripts/*.sh

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/health/status || exit 1

EXPOSE 80

# Switch to non-root user
USER appuser

# Use startup script
CMD ["./start.sh"]