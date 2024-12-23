package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"petadoptions/payforadoption"

	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	_ "github.com/lib/pq"
	"go.opentelemetry.io/contrib/detectors/aws/ecs"
	"go.opentelemetry.io/contrib/propagators/aws/xray"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"go.opentelemetry.io/otel/trace"
)

const otelServiceName = "payforadoption"

var tracer trace.Tracer

func otelInit(ctx context.Context) {
	// OpenTelemetry Go requires an exporter to send traces to a backend
	// Exporters allow telemetry data to be transferred either to the ADOT Collector,
	// or to a remote system or console for further analysis

	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "0.0.0.0:4317" // setting default endpoint for exporter
	}

	traceExporter, err := otlptracegrpc.New(
		ctx,
		otlptracegrpc.WithInsecure(),
		otlptracegrpc.WithEndpoint(endpoint),
	)

	// service name used to display traces in backends
	svcNameResource := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceNameKey.String(otelServiceName),
	)

	ecsResourceDetector := ecs.NewResourceDetector()
	ecsRes, _ := ecsResourceDetector.Detect(ctx)

	mergedResource, err := resource.Merge(ecsRes, svcNameResource)
	if err != nil {
		mergedResource = svcNameResource
	}
	idg := xray.NewIDGenerator()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithBatcher(traceExporter),
		sdktrace.WithIDGenerator(idg),
		sdktrace.WithResource(mergedResource),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(xray.Propagator{})

	tracer = tp.Tracer(otelServiceName)
}

func main() {
	var (
		httpAddr = flag.String("http.addr", ":80", "HTTP Port binding")
	)

	flag.Parse()

	var logger log.Logger
	{
		logger = log.NewJSONLogger(os.Stderr)
		logger = log.With(logger, "ts", log.DefaultTimestampUTC)
		logger = log.With(logger, "caller", log.DefaultCaller)
	}

	ctx := context.Background()
	otelInit(ctx)
	// otelaws.AppendMiddlewares(&cfg.awsCfg.APIOptions)

	var cfg payforadoption.Config
	{
		var err error
		cfg, err = fetchConfig()
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}
	}

	var db *sql.DB
	{
		var err error
		var connStr string

		connStr, err = getRDSConnectionString(cfg.RDSSecretArn)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}

		db, err = sql.Open("postgres", connStr)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}
		defer db.Close()
	}

	var s payforadoption.Service
	{
		repo := payforadoption.NewRepository(db, cfg, logger)
		s = payforadoption.NewService(logger, repo)
		s = payforadoption.NewInstrumenting(logger, s)
	}

	var h http.Handler
	{
		h = payforadoption.MakeHTTPHandler(s, logger)
	}

	errs := make(chan error)
	go func() {
		c := make(chan os.Signal)
		signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
		errs <- fmt.Errorf("%s", <-c)
	}()

	go func() {
		logger.Log("transport", "HTTP", "addr", *httpAddr)
		errs <- http.ListenAndServe(*httpAddr, h)
	}()

	logger.Log("exit", <-errs)
}
