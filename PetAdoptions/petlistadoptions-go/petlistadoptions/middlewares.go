package petlistadoptions

import (
	"context"
	"time"

	"github.com/aws/aws-xray-sdk-go/xray"
	"github.com/go-kit/kit/log"
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

		segment := xray.GetSegment(ctx)

		xray.AddMetadata(ctx, "timeTakenSeconds", time.Since(begin).Seconds())
		xray.AddMetadata(ctx, "resultCount", len(ax))

		//TODO add container id in logs from detector

		if segment != nil {
			mw.logger.Log(
				"method", "ListAdoptions",
				"traceId", segment.TraceID,
				"resultCount", len(ax),
				"took", time.Since(begin),
				"err", err)
		}

	}(time.Now())

	return mw.Service.ListAdoptions(ctx)
}
