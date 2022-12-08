package payforadoption

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-xray-sdk-go/xray"
	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/metrics"
	kitprometheus "github.com/go-kit/kit/metrics/prometheus"
	stdprometheus "github.com/prometheus/client_golang/prometheus"
)

type middleware struct {
	logger         log.Logger
	requestCount   metrics.Counter
	requestLatency metrics.Histogram
	Service
}

func NewInstrumenting(logger log.Logger, s Service) Service {
	labels := []string{"endpoint", "error", "pettype"}
	return &middleware{
		logger:  logger,
		Service: s,
		requestCount: kitprometheus.NewCounterFrom(stdprometheus.CounterOpts{
			Namespace: "payforadoption",
			Name:      "requests_total",
			Help:      "Number of requests received",
		}, labels),
		requestLatency: kitprometheus.NewHistogramFrom(stdprometheus.HistogramOpts{
			Namespace: "payforadoption",
			Name:      "requests_latency_seconds",
			Help:      "Request durations in seconds",
		}, labels),
	}
}

func (mw *middleware) CompleteAdoption(ctx context.Context, petId, petType string) (a Adoption, err error) {
	defer func(begin time.Time) {

		labelValues := []string{
			"endpoint", "complete_adoptions",
			"error", fmt.Sprint(err != nil),
			"pettype", petType,
		}
		mw.requestCount.With(labelValues...).Add(1)
		mw.requestLatency.With(labelValues...).Observe(time.Since(begin).Seconds())

		segment := xray.GetSegment(ctx)

		xray.AddAnnotation(ctx, "PetId", petId)
		xray.AddAnnotation(ctx, "PetType", petType)
		xray.AddMetadata(ctx, "timeTakenSeconds", time.Since(begin).Seconds())

		mw.logger.Log(
			"method", "In CompleteAdoption",
			"traceId", segment.TraceID,
			"PetId", petId,
			"PetType", petType,
			"took", time.Since(begin),
			"customer", getFakeCustomer(),
			"err", err)
	}(time.Now())

	return mw.Service.CompleteAdoption(ctx, petId, petType)
}

func (mw *middleware) CleanupAdoptions(ctx context.Context) (err error) {
	defer func(begin time.Time) {

		labelValues := []string{
			"endpoint", "cleanup_adoptions",
			"error", fmt.Sprint(err != nil),
			"pettype", "",
		}
		mw.requestCount.With(labelValues...).Add(1)
		mw.requestLatency.With(labelValues...).Observe(time.Since(begin).Seconds())

		segment := xray.GetSegment(ctx)
		xray.AddMetadata(ctx, "timeTakenSeconds", time.Since(begin).Seconds())

		mw.logger.Log(
			"method", "In CleanupAdoptions",
			"traceId", segment.TraceID,
			"took", time.Since(begin),
			"err", err)
	}(time.Now())

	return mw.Service.CleanupAdoptions(ctx)
}

func (mw *middleware) HealthCheck(ctx context.Context) (err error) {
	defer func(begin time.Time) {
		labelValues := []string{
			"endpoint", "health_check",
			"error", fmt.Sprint(err != nil),
			"pettype", "",
		}
		mw.requestCount.With(labelValues...).Add(1)
		mw.requestLatency.With(labelValues...).Observe(time.Since(begin).Seconds())
	}(time.Now())
	return mw.Service.HealthCheck(ctx)
}
