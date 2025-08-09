FROM public.ecr.aws/docker/library/golang:1.23 as builder
WORKDIR /go/src/app
COPY . .
ENV GOPROXY=https://goproxy.io,direct
RUN go get .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o app .

FROM public.ecr.aws/docker/library/alpine:3.22.1
WORKDIR /app
RUN apk --no-cache add ca-certificates
COPY --from=builder /go/src/app/app .
EXPOSE 80
CMD ["./app"]
