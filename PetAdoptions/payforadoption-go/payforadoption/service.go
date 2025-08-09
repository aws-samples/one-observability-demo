package payforadoption

import (
	"context"
	"errors"
	"runtime"
	"time"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"github.com/gofrs/uuid"
	"go.opentelemetry.io/otel/trace"
)

type Adoption struct {
	TransactionID string    `json:"transactionid,omitempty"`
	PetID         string    `json:"petid,omitempty"`
	PetType       string    `json:"pettype,omitempty"`
	UserID        string    `json:"userid,omitempty"`
	AdoptionDate  time.Time `json:"adoptiondate,omitempty"`
}

// links endpoints to transport
type Service interface {
	HealthCheck(ctx context.Context) error
	CompleteAdoption(ctx context.Context, petId, petType, userID string) (Adoption, error)
	CleanupAdoptions(ctx context.Context) error
	TriggerSeeding(ctx context.Context) error
}

// object that handles the logic and complies with interface
type service struct {
	logger     log.Logger
	repository Repository
	tracer     trace.Tracer
}

// inject dependencies into core logic
func NewService(logger log.Logger, rep Repository, tracer trace.Tracer) Service {
	return &service{
		logger:     logger,
		repository: rep,
		tracer:     tracer,
	}
}

// health check logic
func (s service) HealthCheck(ctx context.Context) error {
	return nil
}

// /api/completeadoption logic
func (s service) CompleteAdoption(ctx context.Context, petId, petType, userID string) (Adoption, error) {
	logger := log.With(s.logger, "method", "CompleteAdoption")

	uuid, _ := uuid.NewV4()
	a := Adoption{
		TransactionID: uuid.String(),
		PetID:         petId,
		PetType:       petType,
		UserID:        userID,
		AdoptionDate:  time.Now(),
	}

	// Introduce memory leaks for pettype bunnies. Sorry bunnies :)
	if petType == "bunny" {
		if s.repository.ErrorModeOn(ctx) {
			level.Error(logger).Log("errorMode", "On")
			memoryLeak()
			return a, errors.New("illegal memory allocation")
		} else {
			level.Error(logger).Log("errorMode", "Off")
		}
	}

	if err := s.repository.SendAdoptionMessage(ctx, a); err != nil {
		level.Error(logger).Log("err", err, "action", "send_adoption_message_failed")
		return Adoption{}, err
	}

	err := s.repository.UpdateAvailability(ctx, a)

	return a, err
}

func (s service) CleanupAdoptions(ctx context.Context) error {
	logger := log.With(s.logger, "method", "CleanupAdoptions")

	if err := s.TriggerSeeding(ctx); err != nil {
		level.Error(logger).Log("err", err)
	}

	ctx, parentSpan := s.tracer.Start(ctx, "PG drop tables")
	defer parentSpan.End()
	if err := s.repository.DropTransactions(ctx); err != nil {
		level.Error(logger).Log("err", err)
		return err
	}

	return nil
}

func (s service) TriggerSeeding(ctx context.Context) error {
	span := trace.SpanFromContext(ctx)
	span.AddEvent("Triggering seeding in DDB")

	if err := s.repository.TriggerSeeding(ctx); err != nil {
		logger := log.With(s.logger, "method", "TriggerSeeding")
		level.Error(logger).Log("err", err)
		span.RecordError(err)
		return err
	}

	return nil
}

func memoryLeak() {

	// loosing time
	time.Sleep(time.Duration(1000 * time.Millisecond))

	type T struct {
		v [2 << 20]int
		t *T
	}

	var finalizer = func(t *T) {}

	var x, y T

	// The SetFinalizer call makes x escape to heap.
	runtime.SetFinalizer(&x, finalizer)

	// The following line forms a cyclic reference
	// group with two members, x and y.
	// This causes x and y are not collectable.
	x.t, y.t = &y, &x // y also escapes to heap.
}
