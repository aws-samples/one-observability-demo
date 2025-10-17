/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
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

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	_ "github.com/lib/pq"
	"go.opentelemetry.io/contrib/detectors/aws/ecs"
	"go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws"
	"go.opentelemetry.io/contrib/propagators/aws/xray"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

func getServiceName() string {
	serviceName := os.Getenv("PAYFORADOPTION_SERVICE_NAME")
	if serviceName == "" {
		return "payforadoption-api-go" // default fallback
	}
	return serviceName
}

var tracer trace.Tracer

func otelInit(ctx context.Context, cfg payforadoption.Config) {
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
	if err != nil {
		fmt.Println("init error", err)
	}

	// service name used to display traces in backends
	serviceName := getServiceName()
	svcNameResource := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceNameKey.String(serviceName),
	)

	ecsResourceDetector := ecs.NewResourceDetector()
	ecsRes, _ := ecsResourceDetector.Detect(ctx)

	mergedResource, err := resource.Merge(ecsRes, svcNameResource)
	if err != nil {
		mergedResource = svcNameResource
		fmt.Println("mergedResource error", err)
	}

	// Create SQL span processor for Aurora correlation
	sqlProcessor, err := createSQLSpanProcessor(ctx, cfg)
	if err != nil {
		fmt.Printf("Warning: failed to create SQL span processor: %v\n", err)
	}

	// Create tracer provider with SQL span processor
	var processors []sdktrace.SpanProcessor
	processors = append(processors, sdktrace.NewBatchSpanProcessor(traceExporter))
	if sqlProcessor != nil {
		processors = append(processors, sqlProcessor)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(processors[0]), // Batch processor
		sdktrace.WithResource(mergedResource),
	)

	// Register SQL span processor if available
	if sqlProcessor != nil {
		tp.RegisterSpanProcessor(sqlProcessor)
		fmt.Println("SQL span processor registered for Aurora correlation")
	}

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(xray.Propagator{})

	tracer = tp.Tracer(serviceName)
}

func main() {
	ctx := context.Background()

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

	var cfg payforadoption.Config
	{
		var err error
		cfg, err = fetchConfig(ctx, logger)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}

		// Initialize OpenTelemetry with config for SQL span processor
		otelInit(ctx, cfg)
		cfg.Tracer = tracer
	}

	//auto instrumentation of AWS APIs
	otelaws.AppendMiddlewares(&cfg.AWSCfg.APIOptions)

	var db *sql.DB
	{
		var err error

		// Use enhanced database connection with Aurora correlation attributes
		db, err = createInstrumentedDB(ctx, cfg)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}

		defer db.Close()
	}

	var s payforadoption.Service
	{
		// Create repository - Aurora correlation handled by SQL span processor
		repo, err := createRepository(ctx, db, cfg, logger)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}
		s = payforadoption.NewService(logger, repo, tracer)
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
