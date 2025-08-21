# Build stage
FROM rust:1.89-bookworm AS builder
COPY . .
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim
COPY --from=builder /target/ ./target/

RUN apt-get update && apt install -y openssl
EXPOSE 8080
CMD ["/target/release/petfood-rs"]