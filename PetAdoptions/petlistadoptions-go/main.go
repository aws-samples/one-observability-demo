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
	"go.opentelemetry.io/contrib/detectors/aws/ecs"
	otelxray "go.opentelemetry.io/contrib/propagators/aws/xray"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp"
	"go.opentelemetry.io/otel/exporters/otlp/otlphttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/semconv"
)

func init() {
	// Create new OTLP Exporter struct
	ctx := context.Background()

	exporter, _ := otlp.NewExporter(
		ctx,
		otlphttp.NewDriver(
			otlphttp.WithInsecure(),
			otlphttp.WithEndpoint("0.0.0.0:55681"),
		),
	)

	// AlwaysSample() returns a Sampler that samples every trace.
	// Be careful about using this sampler in a production application with
	// significant traffic: a new trace will be started and exported for every request.
	cfg := sdktrace.Config{
		DefaultSampler: sdktrace.AlwaysSample(),
	}

	// A custom ID Generator to generate traceIDs that conform to
	// AWS X-Ray traceID format
	idg := otelxray.NewIDGenerator()

	// ECS plugin on XRay service map
	ecsResourceDetector := ecs.NewResourceDetector()
	ecsResource, err := ecsResourceDetector.Detect(ctx)

	if err != nil {
		fmt.Println("ECS Resource detection error:", err)
	}
	//*/

	tracesNameResource, _ := resource.New(ctx,
		resource.WithAttributes(
			// the service name used to display traces in backends
			semconv.ServiceNameKey.String("petlistadoptions"),
		),
	)

	// merge custom reources together
	ecsNamedResource := resource.Merge(ecsResource, tracesNameResource)

	// Create a new TraceProvider struct passing in the config, the exporter
	// and the ID Generator we want to use for our tracing
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithConfig(cfg),
		sdktrace.WithSyncer(exporter),
		sdktrace.WithIDGenerator(idg),
		sdktrace.WithResource(ecsNamedResource),
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
