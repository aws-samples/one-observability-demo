FROM public.ecr.aws/docker/library/golang:1.18 as builder
ENV GOPROXY=https://goproxy.io,direct
WORKDIR /go/src/app
COPY . .
RUN go get .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o app .

FROM public.ecr.aws/docker/library/alpine:latest
WORKDIR /app
RUN apk --no-cache add ca-certificates
COPY --from=builder /go/src/app/app .
EXPOSE 8000
CMD ["./app"]
