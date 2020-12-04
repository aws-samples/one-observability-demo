package payforadoption

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

func (mw *middleware) CompleteAdoption(ctx context.Context, petId, petType string) (a Adoption, err error) {
	defer func(begin time.Time) {

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
			"err", err)
	}(time.Now())

	return mw.Service.CompleteAdoption(ctx, petId, petType)
}

func (mw *middleware) CleanupAdoptions(ctx context.Context) (err error) {
	defer func(begin time.Time) {

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
