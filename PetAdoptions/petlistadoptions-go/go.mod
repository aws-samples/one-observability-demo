module petadoptions

go 1.15

require (
	github.com/aws/aws-sdk-go v1.44.273
	github.com/aws/aws-xray-sdk-go v1.8.1
	github.com/go-kit/kit v0.12.0
	github.com/go-logfmt/logfmt v0.6.0 // indirect
	github.com/gorilla/mux v1.8.0
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.16.0 // indirect
	github.com/klauspost/compress v1.16.5 // indirect
	github.com/lib/pq v1.10.9
	github.com/prometheus/client_golang v1.15.1
	github.com/prometheus/common v0.44.0 // indirect
	github.com/prometheus/procfs v0.10.1 // indirect
	github.com/spf13/viper v1.16.0
	github.com/valyala/fasthttp v1.47.0 // indirect
	go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux v0.42.0
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.42.0
	go.opentelemetry.io/contrib/propagators/aws v1.17.0
	go.opentelemetry.io/otel v1.16.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.16.0
	go.opentelemetry.io/otel/sdk v1.16.0
	go.opentelemetry.io/otel/trace v1.16.0
	google.golang.org/genproto v0.0.0-20230530153820-e85fd2cbaebc // indirect
	google.golang.org/grpc v1.55.0
)
