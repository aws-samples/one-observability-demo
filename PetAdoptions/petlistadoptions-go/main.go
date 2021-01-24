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

	"petadoptions/petlistadoptions"

	//"github.com/aws/aws-xray-sdk-go/xray"

	_ "github.com/denisenkom/go-mssqldb"
	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	otelxray "go.opentelemetry.io/contrib/propagators/aws/xray"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func init() {
	// Create new OTLP Exporter struct
	exporter, err := otlp.NewExporter(
		context.Background(),
		otlp.WithInsecure(),
		otlp.WithAddress("0.0.0.0:55680"),
	)
	if err != nil {
		// Handle error here...
		// TODO: logger
	}
	// AlwaysSample() returns a Sampler that samples every trace.
	// Be careful about using this sampler in a production application with
	// significant traffic: a new trace will be started and exported for every request.
	cfg := sdktrace.Config{
		DefaultSampler: sdktrace.AlwaysSample(),
	}

	// A custom ID Generator to generate traceIDs that conform to
	// AWS X-Ray traceID format
	idg := otelxray.NewIDGenerator()

	// Create a new TraceProvider struct passing in the config, the exporter
	// and the ID Generator we want to use for our tracing
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithConfig(cfg),
		sdktrace.WithSyncer(exporter),
		sdktrace.WithIDGenerator(idg),
	)
	// Set the traceprovider and the propagator we want to use
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(otelxray.Propagator{})
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

	var cfg Config
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

		withPassword := true
		connStr, err = getRDSConnectionString(cfg.RDSSecretArn, withPassword)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}

		// OTEL does not instrument yet database/sql, falling back to the native
		// go sql interface
		// https://github.com/open-telemetry/opentelemetry-go-contrib/issues/5
		db, err = sql.Open("sqlserver", connStr)
		if err != nil {
			level.Error(logger).Log("exit", err)
			os.Exit(-1)
		}
		defer db.Close()
	}

	var s petlistadoptions.Service
	{

		safeConnStr, _ := getRDSConnectionString(cfg.RDSSecretArn, false)
		repo := petlistadoptions.NewRepository(db, logger, safeConnStr)
		s = petlistadoptions.NewService(logger, repo, cfg.PetSearchURL)
		s = petlistadoptions.NewInstrumenting(logger, s)
	}

	var h http.Handler
	{
		h = petlistadoptions.MakeHTTPHandler(s, logger)
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
