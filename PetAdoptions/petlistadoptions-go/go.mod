module petadoptions

go 1.15

require (
	github.com/aws/aws-sdk-go v1.36.7
	github.com/aws/aws-xray-sdk-go v1.1.0
	github.com/denisenkom/go-mssqldb v0.9.0
	github.com/go-kit/kit v0.10.0
	github.com/gorilla/mux v1.8.0
	github.com/spf13/viper v1.7.1
	go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux v0.15.1
	go.opentelemetry.io/contrib/instrumentation/net/http v0.11.0 // indirect
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.15.1
	go.opentelemetry.io/contrib/propagators/aws v0.15.1
	go.opentelemetry.io/otel v0.15.0
	go.opentelemetry.io/otel/exporters/otlp v0.15.0
	go.opentelemetry.io/otel/sdk v0.15.0
	golang.org/x/xerrors v0.0.0-20200804184101-5ec99f83aff1 // indirect
	gopkg.in/check.v1 v1.0.0-20190902080502-41f04d3bba15 // indirect
)
