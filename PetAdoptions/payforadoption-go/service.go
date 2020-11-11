package main

import (
	"context"
	"errors"

	"github.com/go-kit/kit/log"
)

type Service interface {
	HealthCheck(ctx context.Context) (string, error)
}

var (
	ErrNotFound = errors.New("not found")
)

type service struct {
	logger log.Logger
}

func NewService(logger log.Logger) Service {
	return &service{
		logger: logger,
	}
}

// not called, written to honor interface
func (s service) HealthCheck(ctx context.Context) (string, error) {
	logger := log.With(s.logger, "method", "HealthCheck")
	logger.Log("health check", ctx)
	return "alive", nil
}
