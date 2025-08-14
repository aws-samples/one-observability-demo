FROM rust:latest as builder
WORKDIR /petfood
COPY . .
RUN cargo build --release
CMD ["./target/release/petfood-rs]

FROM debian:bullseye-slim
RUN apt-get update && apt-get install -y  build-essential && rm -rf /var/lib/apt/lists/*
COPY --from=builder /petfood/target/release/petfood-rs /usr/local/bin/petfood-rs
EXPOSE 80
CMD ["petfood-rs"]