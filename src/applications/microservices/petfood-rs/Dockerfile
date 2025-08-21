# Build stage
FROM rust:1.89-bookworm AS builder
COPY . .
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies and CA certificates
RUN apt-get update && apt-get install -y \
    ca-certificates \
    openssl \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

COPY --from=builder /target/release/petfood-rs /app/petfood-rs

# Create a non-root user for security
RUN useradd -r -s /bin/false petfood && \
    chown petfood:petfood /app/petfood-rs

USER petfood
EXPOSE 8080
CMD ["/app/petfood-rs"]
