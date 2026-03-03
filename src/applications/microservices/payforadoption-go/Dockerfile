FROM public.ecr.aws/docker/library/golang:1.24 as builder
WORKDIR /go/src/app
COPY . .
ENV GOPROXY=direct
RUN go get .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o app .

FROM public.ecr.aws/docker/library/alpine:3.22.1
WORKDIR /app
RUN apk --no-cache add ca-certificates curl aws-cli
RUN addgroup -g 1000 appuser && adduser -D -u 1000 -G appuser appuser
COPY --from=builder /go/src/app/app .
COPY --from=builder /go/src/app/seed.json .
RUN chown -R appuser:appuser /app
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
CMD ["./app"]
