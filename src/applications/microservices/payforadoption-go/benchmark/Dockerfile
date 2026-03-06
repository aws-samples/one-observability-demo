# nosemgrep: dockerfile.security.missing-healthcheck.missing-healthcheck
# This is a benchmark/testing tool, not a long-running service - HEALTHCHECK not applicable
FROM public.ecr.aws/docker/library/rust:latest as builder
WORKDIR /app
COPY . .
RUN cargo install drill
RUN groupadd -g 1000 appuser && useradd -r -u 1000 -g appuser appuser && \
    chown -R appuser:appuser /app
USER appuser
CMD ["./benchmark.sh"]
