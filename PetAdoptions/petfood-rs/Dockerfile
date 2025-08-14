# Build stage
FROM rust:latest AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything and build
COPY . .

# Build the application
RUN cargo build --release

# Runtime stage  
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN useradd -m -u 1001 appuser

# Copy the binary from builder stage
COPY --from=builder /app/target/release/petfood-rs /usr/local/bin/petfood-rs

# Change ownership and make executable
RUN chown appuser:appuser /usr/local/bin/petfood-rs && \
    chmod +x /usr/local/bin/petfood-rs

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Set the binary as entrypoint
ENTRYPOINT ["/usr/local/bin/petfood-rs"]
