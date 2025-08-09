FROM public.ecr.aws/docker/library/rust:trixie as builder
WORKDIR /app
RUN
COPY . .
RUN cargo install drill
CMD ["./benchmark.sh"]
