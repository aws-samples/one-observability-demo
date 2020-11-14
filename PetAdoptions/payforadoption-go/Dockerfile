FROM golang:1.15 as builder
WORKDIR /go/src/app
COPY . .
RUN go get .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o app .

FROM alpine:latest
WORKDIR /app
RUN apk --no-cache add ca-certificates
COPY --from=builder /go/bin/app .
EXPOSE 8080
CMD ["./app"]
