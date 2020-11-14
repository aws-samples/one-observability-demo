package main

import (
	"context"
	"fmt"
	"time"

	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	"github.com/gofrs/uuid"
)

// links endpoints to transport
type Service interface {
	HealthCheck(ctx context.Context) (string, error)
	CompleteAdoption(ctx context.Context, petId, petType string) (string, error)
}

// object that handles the logic and complies with interface
type service struct {
	logger     log.Logger
	repository Repository
}

//inject dependencies into core logic
func NewService(logger log.Logger, rep Repository) Service {
	return &service{
		logger:     logger,
		repository: rep,
	}
}

// health check logic
func (s service) HealthCheck(ctx context.Context) (string, error) {
	logger := log.With(s.logger, "method", "HealthCheck")
	logger.Log("health check", ctx)
	return "alive", nil
}

// /api/completeadoption logic
func (s service) CompleteAdoption(ctx context.Context, petId, petType string) (string, error) {
	logger := log.With(s.logger, "method", "CompleteAdoption")

	uuid, _ := uuid.NewV4()
	tx := Transaction{
		ID:           uuid.String(),
		PetID:        petId,
		AdoptionDate: time.Now(),
	}

	logger.Log(
		"traceId", "xray Trace to retrieve",
		"transaction", fmt.Sprintf("%#v", tx),
	)

	if err := s.repository.CreateTransaction(ctx, tx); err != nil {
		level.Error(logger).Log("err", err)
		return "tx creation failed", err
	}

	return "success", nil
}
