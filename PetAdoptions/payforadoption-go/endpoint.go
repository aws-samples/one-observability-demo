package main

import (
	"context"

	"github.com/go-kit/kit/endpoint"
)

type Endpoints struct {
	HealthCheckEndpoint      endpoint.Endpoint
	CompleteAdoptionEndpoint endpoint.Endpoint
	CleanupAdoptionsEndpoint endpoint.Endpoint
}

func MakeEndpoints(s Service) Endpoints {
	return Endpoints{
		HealthCheckEndpoint:      makeHealthCheckEndpoint(s),
		CompleteAdoptionEndpoint: makeCompleteAdoptionEndpoint(s),
		CleanupAdoptionsEndpoint: makeCleanupAdoptionsEndpoint(s),
	}
}

func makeHealthCheckEndpoint(s Service) endpoint.Endpoint {
	return func(ctx context.Context, _ interface{}) (interface{}, error) {
		return s.HealthCheck(ctx)
	}
}

func makeCompleteAdoptionEndpoint(s Service) endpoint.Endpoint {
	return func(ctx context.Context, request interface{}) (interface{}, error) {
		req := request.(completeAdoptionRequest)
		return s.CompleteAdoption(ctx, req.PetId, req.PetType)
	}
}

func makeCleanupAdoptionsEndpoint(s Service) endpoint.Endpoint {
	return func(ctx context.Context, _ interface{}) (interface{}, error) {
		return s.CleanupAdoptions(ctx)
	}
}
