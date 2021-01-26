package petlistadoptions

import (
	"context"
	"time"

	"github.com/go-kit/kit/log"
	"go.opentelemetry.io/otel/label"
	"go.opentelemetry.io/otel/trace"
)

type middleware struct {
	logger log.Logger
	Service
}

func NewInstrumenting(logger log.Logger, s Service) Service {

	return &middleware{
		logger:  logger,
		Service: s,
	}
}

func (mw *middleware) ListAdoptions(ctx context.Context) (ax []Adoption, err error) {
	defer func(begin time.Time) {

		span := trace.SpanFromContext(ctx)

		if span == nil {
			return
		}

		span.SetAttributes(
			label.Float64("timeTakenSeconds", time.Since(begin).Seconds()),
			label.Int("resultCount", len(ax)),
		)

		spanCtx := span.SpanContext()

		mw.logger.Log(
			"method", "ListAdoptions",
			"traceId", spanCtx.TraceID,
			"SpanID", spanCtx.SpanID,
			"resultCount", len(ax),
			"took", time.Since(begin),
			"err", err)
	}(time.Now())

	return mw.Service.ListAdoptions(ctx)
}
