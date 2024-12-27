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

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	_ "github.com/lib/pq"
	"go.opentelemetry.io/contrib/propagators/aws/xray"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"google.golang.org/grpc"
)

func init() {
	// Create new OTLP Exporter struct
	ctx := context.Background()

	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "0.0.0.0:4317" // setting default endpoint for exporter
	}
	traceExporter, _ := otlptracegrpc.New(ctx, otlptracegrpc.WithInsecure(), otlptracegrpc.WithEndpoint(endpoint), otlptracegrpc.WithDialOption(grpc.WithBlock()))

	res := resource.NewWithAttributes(
		semconv.SchemaURL,
		// the service name used to display traces in backends
		semconv.ServiceNameKey.String("petlistadoptions"),
		//semconv.AWSLogGroupNamesKey.String("/ecs/PetListAdoptions"),
	)
	// Create a new TraceProvider struct passing in the config, the exporter
	// and the ID Generator we want to use for our tracing
	tp := sdktrace.NewTracerProvider(
		// AlwaysSample() returns a Sampler that samples every trace.
		// Be careful about using this sampler in a production application with
		// significant traffic: a new trace will be started and exported for every request.
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithBatcher(traceExporter),
		sdktrace.WithResource(res),
	)
	// Set the traceprovider and the propagator we want to use
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(xray.Propagator{})
}

func main() {
	var (
		httpAddr = flag.String("http.addr", ":80", "HTTP Port binding")
	)

	flag.Parse()

	var logger log.Logger
	logger = log.NewJSONLogger(log.NewSyncWriter(os.Stdout))
	logger = log.With(logger, "ts", log.DefaultTimestampUTC, "caller", log.DefaultCaller)

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
		db, err = sql.Open("postgres", connStr)
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
