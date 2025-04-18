package petlistadoptions

import (
	"context"
	"fmt"
	"time"

	"github.com/go-kit/kit/metrics"
	kitprometheus "github.com/go-kit/kit/metrics/prometheus"
	"github.com/go-kit/log"
	stdprometheus "github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type middleware struct {
	logger         log.Logger
	requestCount   metrics.Counter
	requestLatency metrics.Histogram
	Service
}

func NewInstrumenting(logger log.Logger, s Service) Service {
	labels := []string{"endpoint", "error"}
	return &middleware{
		logger:  logger,
		Service: s,
		requestCount: kitprometheus.NewCounterFrom(stdprometheus.CounterOpts{
			Namespace: "petlistadoptions",
			Name:      "requests_total",
			Help:      "Number of requests received",
		}, labels),
		requestLatency: kitprometheus.NewHistogramFrom(stdprometheus.HistogramOpts{
			Namespace: "petlistadoptions",
			Name:      "requests_latency_seconds",
			Help:      "Request durations in seconds",
		}, labels),
	}
}

func (mw *middleware) ListAdoptions(ctx context.Context) (ax []Adoption, err error) {
	defer func(begin time.Time) {
		labelValues := []string{"endpoint", "adoptionlist", "error", fmt.Sprint(err != nil)}
		mw.requestCount.With(labelValues...).Add(1)
		mw.requestLatency.With(labelValues...).Observe(time.Since(begin).Seconds())

		span := trace.SpanFromContext(ctx)
		if span == nil {
			return
		}

		span.SetAttributes(
			attribute.Float64("timeTakenSeconds", time.Since(begin).Seconds()),
			attribute.Int("resultCount", len(ax)),
		)

		err2 := mw.logger.Log(
			"method", "ListAdoptionsMiddleware",
			"xrayTraceId", getXrayTraceID(span),
			"resultCount", len(ax),
			"took", time.Since(begin),
			"err", err)
		if err2 != nil {
			fmt.Println("log error", err2)
		}
	}(time.Now())

	return mw.Service.ListAdoptions(ctx)
}

func (mw *middleware) HealthCheck(ctx context.Context) (res string, err error) {
	defer func(begin time.Time) {
		labelValues := []string{"endpoint", "health_check", "error", fmt.Sprint(err != nil)}
		mw.requestCount.With(labelValues...).Add(1)
		mw.requestLatency.With(labelValues...).Observe(time.Since(begin).Seconds())
	}(time.Now())
	return mw.Service.HealthCheck(ctx)
}

func getXrayTraceID(span trace.Span) string {
	xrayTraceID := span.SpanContext().TraceID().String()
	result := fmt.Sprintf("1-%s-%s", xrayTraceID[0:8], xrayTraceID[8:])
	return result
}
