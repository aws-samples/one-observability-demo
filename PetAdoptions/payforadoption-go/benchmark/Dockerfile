FROM rust:latest as builder
WORKDIR /app
RUN
COPY . .
RUN cargo install drill
CMD ["./benchmark.sh"]
