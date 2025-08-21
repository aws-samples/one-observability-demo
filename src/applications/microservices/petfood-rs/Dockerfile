# Build stage
FROM rust:1.89-bookworm AS builder
COPY . .
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim
COPY --from=builder /target/ ./target/

RUN apt-get update && apt-get install -y \
    ca-certificates \
    openssl \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

EXPOSE 8080
CMD ["/target/release/petfood-rs"]