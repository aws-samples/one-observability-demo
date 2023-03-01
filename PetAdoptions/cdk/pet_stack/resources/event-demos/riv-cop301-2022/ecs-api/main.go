package main

//#region imports and config

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"
	"go.uber.org/zap"

	"go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux"
	"go.opentelemetry.io/contrib/propagators/aws/xray"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"go.opentelemetry.io/otel/trace"
)

type Config struct {
	dataAPI          string
	dataAPIRegion    string
	exporterEndpoint string
	sess             *session.Session
	log              *zap.SugaredLogger
}
type ColorRequest struct {
	Color string `json:"color"`
}

type ColorResponse struct {
	Color    string `json:"color,omitempty"`
	Source   string `json:"source,omitempty"`
	Location string `json:"location,omitempty"`
	Count    int    `json:"count,omitempty"`
}

func newConfig(log *zap.SugaredLogger) *Config {
	// Need AWS session to sign queries to Lambda Function URLs
	sess := session.Must(session.NewSessionWithOptions(session.Options{
		SharedConfigState: session.SharedConfigEnable,
	}))

	hostIP := os.Getenv("HOST_IP")
	if hostIP == "" {
		hostIP = "localhost" // setting default endpoint for exporter
	}
	endpoint := fmt.Sprintf("%s:4317", hostIP)

	dataAPI := os.Getenv("DATA_API")
	if dataAPI == "" {
		log.Fatal("Failed to get DATA_API")
	}

	dataAPIRegion := os.Getenv("DATA_API_REGION")
	if dataAPIRegion == "" {
		log.Fatal("Failed to get DATA_API_REGION")
	}

	return &Config{
		sess:             sess,
		log:              log,
		dataAPI:          dataAPI,
		dataAPIRegion:    dataAPIRegion,
		exporterEndpoint: endpoint,
	}
}

//#endregion imports and config

func otelInit(ctx context.Context, cfg *Config) {
	cfg.log.Info("Initializing OpenTelemetry")
	// https://aws-otel.github.io/docs/getting-started/go-sdk/trace-manual-instr

	// OpenTelemetry Go requires an exporter to send traces to a backend
	// Exporters allow telemetry data to be transferred either to the ADOT Collector,
	// or to a remote system or console for further analysis
	traceExporter, err := otlptracegrpc.New(
		ctx,
		otlptracegrpc.WithInsecure(),
		otlptracegrpc.WithEndpoint(cfg.exporterEndpoint),
	)
	cfg.log.Info("Initialized trace exporter")
	logError(err, "failed to create new OTLP trace exporter", cfg.log, nil)

	// service name used to display traces in backends
	svcNameResource := resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceNameKey.String(xrayServiceName),
	)

	// In order to generate traces, OpenTelemetry Go SDK requires a tracer provider to be created
	// with an ID Generator that will generate trace IDs that conform to AWS X-Ray’s format
	idg := xray.NewIDGenerator()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithBatcher(traceExporter),
		sdktrace.WithIDGenerator(idg),
		sdktrace.WithResource(svcNameResource),
	)

	// In addition to setting a global tracer provider, we will also configure the context propagation option.
	// Context propagation refers to sharing data across multiple processes or services.
	// Propagator structs are configured inside Tracer structs to support context propagation across process boundaries.
	// A context will often have information identifying the current span and trace, and can contain arbitrary information as key-value pairs.
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(xray.Propagator{})
}

var (
	votes = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "cop301_votes_total",
		Help: "Number of votes",
	}, []string{"color"})
)

const xrayServiceName = "cop301-api"

func init() {
	prometheus.MustRegister(votes)
}

func main() {
	//#region main
	ctx := context.Background()

	logger, _ := zap.NewProduction()
	defer logger.Sync()
	log := logger.Sugar()

	cfg := newConfig(log)
	otelInit(ctx, cfg)

	//#endregion main
	// HTTP server router
	r := mux.NewRouter()

	// Use open telementry instrumentation provided by the Gorilla mux framework
	r.Use(otelmux.Middleware(xrayServiceName))

	// Serve Prometheus metrics
	r.Methods("GET").Path("/metrics").Handler(promhttp.Handler())

	//#region handlers and server
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		log.Info("health check request")
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})

	r.Methods("POST").Path("/votes").Handler(votesHandler(cfg))

	errs := make(chan error)
	go func() {
		c := make(chan os.Signal)
		signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
		errs <- fmt.Errorf("%s", <-c)
	}()

	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowCredentials: true,
	})
	handler := c.Handler(r)

	go func() {
		log.Info("Starting server on :8000 ...")
		errs <- http.ListenAndServe(":8000", handler)
	}()
	log.Warn("exit", <-errs)
	//#endregion handlers and server
}

func votesHandler(cfg *Config) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		// Context propagates the X-Ray trace ID
		ctx := r.Context()

		// get the current span from the context
		span := trace.SpanFromContext(ctx)

		resp, err := signedQuery(ctx, cfg, "POST", cfg.dataAPI, r.Body)

		//#region err management
		if err != nil {
			logError(err, "query error", cfg.log, span)
			encodeError(ctx, err, w)
			return
		}
		//#endregion err management
		cfg.log.Infow("response",
			"statuscode", resp.StatusCode,
			"status", resp.Status,
			"xrayTraceID", getXrayTraceID(span),
		)
		//#region http response handling
		var colorResponse ColorResponse
		if err = json.NewDecoder(resp.Body).Decode(&colorResponse); err != nil {
			cfg.log.Fatalw("decode failed",
				"error", err,
				"xrayTraceID", getXrayTraceID(span),
			)
			encodeError(ctx, err, w)
			return
		}
		cfg.log.Info(colorResponse)
		//#endregion http response handling

		labelValues := []string{colorResponse.Color}
		votes.WithLabelValues(labelValues...).Inc()

		locationRes, err := query(ctx, cfg, "GET", "https://checkip.amazonaws.com/", nil)
		//#region http response handling
		if err != nil {
			logError(err, "query error", cfg.log, span)
			encodeError(ctx, err, w)
			return
		}
		defer locationRes.Body.Close()
		b, err := io.ReadAll(resp.Body)
		bodyString := string(b)
		cfg.log.Infow("response body",
			"err", err,
			"b", bodyString,
			"xrayTraceID", getXrayTraceID(span),
		)
		encodeResponse(ctx, w, colorResponse)
		//#endregion http response handling
	})
}
