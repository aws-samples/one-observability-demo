package payforadoption

import (
	"context"
	"time"

	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	"github.com/gofrs/uuid"
)

type Adoption struct {
	TransactionID string `json:"transactionid,omitempty"`
	PetID         string `json:"petid,omitempty"`
	PetType       string `json:"pettype,omitempty"`
	AdoptionDate  time.Time
}

// links endpoints to transport
type Service interface {
	HealthCheck(ctx context.Context) error
	CompleteAdoption(ctx context.Context, petId, petType string) (Adoption, error)
	CleanupAdoptions(ctx context.Context) error
	TriggerSeeding(ctx context.Context) error
}

// object that handles the logic and complies with interface
type service struct {
	logger               log.Logger
	repository           Repository
	updateAdoptionURL    string
	ddbSeedingLambdaName string
}

//inject dependencies into core logic
func NewService(logger log.Logger, rep Repository) Service {
	return &service{
		logger:     logger,
		repository: rep,
	}
}

// health check logic
func (s service) HealthCheck(ctx context.Context) error {
	return nil
}

// /api/completeadoption logic
func (s service) CompleteAdoption(ctx context.Context, petId, petType string) (Adoption, error) {

	uuid, _ := uuid.NewV4()
	a := Adoption{
		TransactionID: uuid.String(),
		PetID:         petId,
		PetType:       petType,
		AdoptionDate:  time.Now(),
	}

	if err := s.repository.CreateTransaction(ctx, a); err != nil {
		logger := log.With(s.logger, "method", "CompleteAdoption")
		level.Error(logger).Log("err", err)
		return Adoption{}, err
	}

	return a, s.repository.UpdateAvailability(ctx, a)
}

func (s service) CleanupAdoptions(ctx context.Context) error {

	if err := s.repository.DropTransactions(ctx); err != nil {
		logger := log.With(s.logger, "method", "CleanupAdoptions")
		level.Error(logger).Log("err", err)
		return err
	}

	return s.TriggerSeeding(ctx)
}

func (s service) TriggerSeeding(ctx context.Context) error {

	if err := s.repository.TriggerSeeding(ctx); err != nil {
		logger := log.With(s.logger, "method", "TriggerSeeding")
		level.Error(logger).Log("err", err)
		return err
	}

	return nil
}
