package petlistadoptions

import (
	"context"
	"time"

	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
)

type Adoption struct {
	TransactionID string    `json:"transactionid,omitempty"`
	AdoptionDate  time.Time `json:"adoptiondate,omitempty"`
	Availability  string    `json:"availability,omitempty"`
	CutenessRate  string    `json:"cuteness_rate,omitempty"`
	PetColor      string    `json:"petcolor,omitempty"`
	PetID         string    `json:"petid,omitempty"`
	PetType       string    `json:"pettype,omitempty"`
	PetURL        string    `json:"peturl,omitempty"`
	Price         string    `json:"price,omitempty"`
}

// links endpoints to transport
type Service interface {
	HealthCheck(ctx context.Context) (string, error)
	ListAdoptions(ctx context.Context) ([]Adoption, error)
}

// object that handles the logic and complies with interface
type service struct {
	logger       log.Logger
	repository   Repository
	petSearchURL string
}

//inject dependencies into core logic
func NewService(logger log.Logger, rep Repository, petSearchURL string) Service {
	return &service{
		logger:       logger,
		repository:   rep,
		petSearchURL: petSearchURL,
	}
}

func (s service) HealthCheck(ctx context.Context) (string, error) {
	return "alive", nil
}

func (s service) ListAdoptions(ctx context.Context) ([]Adoption, error) {

	res, err := s.repository.GetLatestAdoptions(ctx, s.petSearchURL)

	if err != nil {
		logger := log.With(s.logger, "method", "ListAdoptions")
		level.Error(logger).Log("err", err)
	}

	return res, err
}
