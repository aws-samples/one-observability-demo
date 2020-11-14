package main

import (
	"context"

	"github.com/go-kit/kit/log"
)

// links endpoints to transport
type Service interface {
	HealthCheck(ctx context.Context) (string, error)
}

// object that handles the logic and complies with interface
type service struct {
	logger log.Logger
}

func NewService(logger log.Logger) Service {
	return &service{
		logger: logger,
	}
}

func (s service) HealthCheck(ctx context.Context) (string, error) {
	logger := log.With(s.logger, "method", "HealthCheck")
	logger.Log("health check", ctx)
	return "alive", nil
}

/*
func (s service) CompleteAdoption(ctx context.Context, a Adoption) (string, error) {

}
*/
