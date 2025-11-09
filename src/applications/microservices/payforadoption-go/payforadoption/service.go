/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package payforadoption

import (
	"context"
	"time"

	"github.com/go-kit/log"
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
	CleanupAdoptions(ctx context.Context, userID string) error
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

	if err := s.repository.ValidatePet(ctx, a); err != nil {
		ErrorWithTrace(ctx, logger, "err", err)
		return Adoption{}, ErrBadRequest
	}

	// Log the start of the adoption process
	InfoWithTrace(ctx, logger,
		"action", "adoption_process_started",
		"transactionId", a.TransactionID,
		"petId", petId,
		"petType", petType,
		"userId", userID,
	)

	// Introduce degraded experience when error mode is enabled
	if s.repository.ErrorModeOn(ctx) {
		ErrorWithTrace(ctx, logger, "errorMode", "On", "petType", petType, "userID", userID)

		startTime := time.Now()

		// Apply different degradation strategies
		result := handleDefaultDegradation(ctx, logger, a, startTime, s.repository)

		// Return the result from the degradation scenario
		if result.Error != nil {
			return result.Adoption, result.Error
		}

		// Update the adoption with any modifications from degradation
		a = result.Adoption
	}

	// Step 1: Create transaction in database (synchronous)
	if err := s.repository.CreateTransaction(ctx, a); err != nil {
		ErrorWithTrace(ctx, logger, "err", err, "action", "create_transaction_failed")
		return Adoption{}, err
	}
	InfoWithTrace(ctx, logger, "action", "transaction_created_successfully", "transactionId", a.TransactionID)

	// Step 2: Update pet availability (synchronous)
	if err := s.repository.UpdateAvailability(ctx, a); err != nil {
		ErrorWithTrace(ctx, logger, "err", err, "action", "update_availability_failed")
		return Adoption{}, err
	}
	InfoWithTrace(ctx, logger, "action", "availability_updated_successfully", "petId", a.PetID)

	// Step 3: Send history message to SQS (asynchronous - don't fail if this fails)
	if err := s.repository.SendHistoryMessage(ctx, a); err != nil {
		WarnWithTrace(ctx, logger, "err", err, "action", "send_history_message_failed", "note", "continuing despite history message failure")
		// Don't return error - history tracking is not critical for adoption success
	} else {
		InfoWithTrace(ctx, logger, "action", "history_message_sent_successfully", "transactionId", a.TransactionID)
	}

	// Log successful completion of the entire adoption process
	InfoWithTrace(ctx, logger,
		"action", "adoption_completed_successfully",
		"transactionId", a.TransactionID,
		"petId", a.PetID,
		"petType", a.PetType,
		"userId", a.UserID,
	)

	return a, nil
}

func (s service) CleanupAdoptions(ctx context.Context, userID string) error {
	logger := log.With(s.logger, "method", "CleanupAdoptions", "userID", userID)

	ctx, parentSpan := s.tracer.Start(ctx, "PG drop user transactions")
	defer parentSpan.End()
	if err := s.repository.DropTransactions(ctx); err != nil {
		ErrorWithTrace(ctx, logger, "err", err)
		return err
	}

	InfoWithTrace(ctx, logger, "action", "user_transactions_cleaned", "userID", userID)
	return nil
}

func (s service) TriggerSeeding(ctx context.Context) error {
	logger := log.With(s.logger, "method", "TriggerSeeding")
	span := trace.SpanFromContext(ctx)
	span.AddEvent("Triggering seeding in DDB")

	InfoWithTrace(ctx, logger, "action", "seeding_process_started")

	if err := s.repository.TriggerSeeding(ctx); err != nil {
		ErrorWithTrace(ctx, logger, "err", err)
		span.RecordError(err)
		return err
	}

	InfoWithTrace(ctx, logger, "action", "seeding_completed_successfully")
	return nil
}
