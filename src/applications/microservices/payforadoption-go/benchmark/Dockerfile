# nosemgrep: dockerfile.security.missing-healthcheck.missing-healthcheck
# This is a benchmark/testing tool, not a long-running service - HEALTHCHECK not applicable
FROM public.ecr.aws/docker/library/rust:latest as builder
WORKDIR /app
COPY . .
RUN cargo install drill
RUN addgroup --gid 1000 appuser && adduser --disabled-password --uid 1000 --ingroup appuser appuser
RUN chown -R appuser:appuser /app
USER appuser
CMD ["./benchmark.sh"]
