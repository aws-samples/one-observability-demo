# Build stage
FROM public.ecr.aws/docker/library/rust:bookworm AS builder
COPY . .
RUN cargo build --release

# Runtime stage
FROM public.ecr.aws/docker/library/debian:bookworm-slim

# Install runtime dependencies and CA certificates
RUN apt-get update && apt-get install -y \
    ca-certificates \
    openssl \
    curl \
    unzip \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws \
    && apt-get remove -y unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

COPY --from=builder /target/release/petfood-rs /app/petfood-rs

# Create a non-root user for security
RUN useradd -r -s /bin/false petfood && \
    chown petfood:petfood /app/petfood-rs

USER petfood
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
CMD ["/app/petfood-rs"]
