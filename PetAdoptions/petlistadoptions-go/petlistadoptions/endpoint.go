package petlistadoptions

import (
	"context"

	"github.com/go-kit/kit/endpoint"
)

type Endpoints struct {
	HealthCheckEndpoint   endpoint.Endpoint
	ListAdoptionsEndpoint endpoint.Endpoint
}

func MakeEndpoints(s Service) Endpoints {
	return Endpoints{
		HealthCheckEndpoint:   makeHealthCheckEndpoint(s),
		ListAdoptionsEndpoint: makeListAdoptionsEndpoint(s),
	}
}

func makeHealthCheckEndpoint(s Service) endpoint.Endpoint {
	return func(ctx context.Context, _ interface{}) (interface{}, error) {
		return s.HealthCheck(ctx)
	}
}

func makeListAdoptionsEndpoint(s Service) endpoint.Endpoint {
	return func(ctx context.Context, request interface{}) (interface{}, error) {
		return s.ListAdoptions(ctx)
	}
}
