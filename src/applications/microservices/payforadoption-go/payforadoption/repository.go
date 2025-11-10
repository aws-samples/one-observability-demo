/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package payforadoption

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/dghubble/sling"
	"github.com/go-kit/log"
	"github.com/guregu/dynamo/v2"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/trace"
)

// Repository as an interface to define data store interactions
type Repository interface {
	CreateTransaction(ctx context.Context, a Adoption) error
	SendHistoryMessage(ctx context.Context, a Adoption) error
	DropTransactions(ctx context.Context) error
	UpdateAvailability(ctx context.Context, a Adoption) error
	ResetPetsAvailability(ctx context.Context) error
	ValidatePet(ctx context.Context, a Adoption) error
	TriggerSeeding(ctx context.Context) error
	CreateSQLTables(ctx context.Context) error
	ErrorModeOn(ctx context.Context) bool
	GetConnectionString(ctx context.Context) (string, error)
}

type Config struct {
	UpdateAdoptionURL    string
	PetSearchURL         string
	RDSSecretArn         string
	S3BucketName         string
	DynamoDBTable        string
	SQSQueueURL          string
	AWSRegion            string
	Tracer               trace.Tracer
	AWSCfg               aws.Config
	DDBInterfaceEndpoint string
	S3InterfaceEndpoint  string
}

var RepoErr = errors.New("unable to handle Repo Request")

// repo as an implementation of Repository with dependency injection
type repo struct {
	db     *sql.DB
	cfg    Config
	logger log.Logger
	dbSvc  *DatabaseConfigService
}

func NewRepository(db *sql.DB, cfg Config, logger log.Logger) Repository {
	return &repo{
		db:     db,
		cfg:    cfg,
		logger: log.With(logger, "repo", "sql"),
		dbSvc:  NewDatabaseConfigService(cfg),
	}
}

func (r *repo) CreateTransaction(ctx context.Context, a Adoption) error {
	span := trace.SpanFromContext(ctx)
	span.AddEvent("creating transaction in PG DB")

	sql := `INSERT INTO transactions (pet_id, pet_type, adoption_date, transaction_id, user_id) VALUES ($1, $2, $3, $4, $5)`

	r.logger.Log("sql", sql)
	_, err := r.db.ExecContext(ctx, sql, a.PetID, a.PetType, a.AdoptionDate, a.TransactionID, a.UserID)
	if err != nil {
		span.RecordError(err)
		ErrorWithTrace(ctx, r.logger, "error", "failed to create transaction", "err", err)
		return NewInternalError("failed to create transaction in database", err)
	}

	InfoWithTrace(ctx, r.logger,
		"action", "transaction_created",
		"transactionId", a.TransactionID,
		"petId", a.PetID,
		"petType", a.PetType,
		"userId", a.UserID,
	)

	return nil
}

func (r *repo) SendHistoryMessage(ctx context.Context, a Adoption) error {
	// Create SQS client
	sqsClient := sqs.NewFromConfig(r.cfg.AWSCfg)

	// Prepare the adoption history message
	historyMessage := map[string]interface{}{
		"transactionId": a.TransactionID,
		"petId":         a.PetID,
		"petType":       a.PetType,
		"userId":        a.UserID,
		"adoptionDate":  a.AdoptionDate.Format(time.RFC3339),
		"timestamp":     time.Now().Format(time.RFC3339),
	}

	// Convert to JSON
	messageBody, err := json.Marshal(historyMessage)
	if err != nil {
		ErrorWithTrace(ctx, r.logger, "error", "failed to marshal history message", "err", err)
		return NewInternalError("failed to marshal history message", err)
	}

	// Send message to SQS
	input := &sqs.SendMessageInput{
		QueueUrl:    aws.String(r.cfg.SQSQueueURL),
		MessageBody: aws.String(string(messageBody)),
		MessageAttributes: map[string]types.MessageAttributeValue{
			"PetType": {
				DataType:    aws.String("String"),
				StringValue: aws.String(a.PetType),
			},
			"UserID": {
				DataType:    aws.String("String"),
				StringValue: aws.String(a.UserID),
			},
			"TransactionID": {
				DataType:    aws.String("String"),
				StringValue: aws.String(a.TransactionID),
			},
		},
	}

	result, err := sqsClient.SendMessage(ctx, input)
	if err != nil {
		ErrorWithTrace(ctx, r.logger, "error", "failed to send history message to SQS", "err", err, "queueUrl", r.cfg.SQSQueueURL)
		return NewServiceUnavailableError("failed to send history message to SQS", err)
	}

	InfoWithTrace(ctx, r.logger,
		"action", "history_message_sent",
		"messageId", aws.ToString(result.MessageId),
		"queueUrl", r.cfg.SQSQueueURL,
		"transactionId", a.TransactionID,
		"petId", a.PetID,
		"userId", a.UserID,
	)

	return nil
}

func (r *repo) DropTransactions(ctx context.Context) error {
	span := trace.SpanFromContext(ctx)
	span.AddEvent("removing all transactions in PG DB")

	sql := `DELETE FROM transactions`

	result, err := r.db.ExecContext(ctx, sql)
	if err != nil {
		span.RecordError(err)
		ErrorWithTrace(ctx, r.logger, "error", "failed to delete all transactions", "err", err)
		return NewInternalError("failed to delete transactions from database", err)
	}

	rowsAffected, _ := result.RowsAffected()
	InfoWithTrace(ctx, r.logger,
		"action", "user_transactions_deleted",
		"sql", sql,
		"rowsAffected", rowsAffected,
	)

	return nil
}

// callPetUpdater makes an HTTP call to the pet updater service to update pet availability
// req.PetAvailability: "yes" to make pet available, "no" to mark as adopted, empty string uses default behavior
func (r *repo) callPetUpdater(ctx context.Context, req completeAdoptionRequest) error {
	logger := log.With(r.logger, "method", "callPetUpdater")
	ctx, span := r.cfg.Tracer.Start(ctx, "Update Adoption Status")
	defer span.End()

	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport), Timeout: 5 * time.Second}
	httpReq, _ := sling.New().Put(r.cfg.UpdateAdoptionURL).BodyJSON(&req).Request()

	resp, err := client.Do(httpReq.WithContext(ctx))
	if err != nil {
		ErrorWithTrace(ctx, logger, "err", err)
		span.RecordError(err)
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		ErrorWithTrace(ctx, logger, "err", err)
		span.RecordError(err)
		return err
	}

	LogWithTrace(ctx, logger, "response_body", string(respBody), "availability", req.PetAvailability)
	return nil
}

func (r *repo) UpdateAvailability(ctx context.Context, a Adoption) error {
	logger := log.With(r.logger, "method", "UpdateAvailability")
	ctx, parentSpan := r.cfg.Tracer.Start(ctx, "UpdateAvailability")
	defer parentSpan.End()

	errs := make(chan error)
	var wg sync.WaitGroup
	wg.Add(2)

	// Call pet updater service (empty availability = mark as adopted)
	go func() {
		defer wg.Done()
		req := completeAdoptionRequest{
			PetId:   a.PetID,
			PetType: a.PetType,
			UserID:  a.UserID,
		}
		if err := r.callPetUpdater(ctx, req); err != nil {
			errs <- err
		}
	}()

	// Dummy availability check
	go func() {
		defer wg.Done()
		availabilityCtx, availabilitySpan := r.cfg.Tracer.Start(ctx, "Invoking Availability API")
		defer availabilitySpan.End()

		client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport), Timeout: 5 * time.Second}
		request, err := http.NewRequestWithContext(availabilityCtx, http.MethodGet, "https://amazon.com", nil)
		if err != nil {
			ErrorWithTrace(availabilityCtx, logger, "err", err)
			availabilitySpan.RecordError(err)
			errs <- err
			return
		}
		client.Do(request)
	}()

	go func() {
		wg.Wait()
		close(errs)
	}()

	// return the first error
	for err := range errs {
		if err != nil {
			return err
		}
	}

	return nil
}

func (r *repo) ValidatePet(ctx context.Context, a Adoption) error {
	// r.cfg.PetSearchURL
	logger := log.With(r.logger, "method", "ValidatePet")
	ctx, span := r.cfg.Tracer.Start(ctx, "ValidatePet")
	defer span.End()
	// using xray as a wrapper for http client
	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport), Timeout: 5 * time.Second}

	params := &completeAdoptionRequest{
		PetId:   a.PetID,
		PetType: a.PetType,
		UserID:  a.UserID,
	}
	req, _ := sling.New().Get(r.cfg.PetSearchURL).QueryStruct(params).Request()

	InfoWithTrace(ctx, logger, "url", req.URL.String())
	resp, err := client.Do(req.WithContext(ctx))
	if err != nil {
		ErrorWithTrace(ctx, logger, "err", err)
		span.RecordError(err)
		return NewServiceUnavailableError("pet search service unavailable", err)
	}

	if resp.StatusCode != 200 {
		span.AddEvent("Pet not available")
		span.RecordError(err)
		if resp.StatusCode == 404 {
			LogWithTrace(ctx, logger, "status", resp.Status, "message", "Pet not available")
			return NewNotFoundError("pet not available", err)
		}
		err := fmt.Errorf("Petid: %s - Pettype: %s, not available", a.PetID, a.PetType)
		return NewBadRequestError("pet not available", err)
	}

	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		ErrorWithTrace(ctx, logger, "err", err)
		span.RecordError(err)
		return NewInternalError("failed to read pet validation response", err)
	}

	sb := string(body)
	LogWithTrace(ctx, logger, "response_body", sb)

	var pets []Pet
	if err := json.Unmarshal(body, &pets); err != nil {
		ErrorWithTrace(ctx, logger, "err", err)
		span.RecordError(err)
		return NewInternalError("failed to parse pet validation response", err)
	}

	if len(pets) == 0 {
		err := fmt.Errorf("pet not found: petId=%s, petType=%s", a.PetID, a.PetType)
		return NewNotFoundError("pet not found", err)
	}

	// Check if pet is available for adoption
	pet := pets[0]
	if pet.Availability != "yes" {
		err := fmt.Errorf("pet not available for adoption: petId=%s, availability=%s", a.PetID, pet.Availability)
		return NewBadRequestError("pet not available for adoption", err)
	}

	return nil
}

// ResetPetsAvailability updates every adopted pet to availability = yes
// through pet updater using concurrent goroutines
func (r *repo) ResetPetsAvailability(ctx context.Context) error {
	logger := log.With(r.logger, "method", "ResetPetsAvailability")
	span := trace.SpanFromContext(ctx)
	span.AddEvent("resetting pet availability for all adopted pets")

	// Query distinct pet_id and pet_type from transactions
	sql := "SELECT DISTINCT pet_id, pet_type FROM transactions"
	rows, err := r.db.QueryContext(ctx, sql)
	if err != nil {
		span.RecordError(err)
		ErrorWithTrace(ctx, logger, "error", "failed to query distinct pets", "err", err)
		return NewInternalError("failed to query distinct pets from database", err)
	}
	defer rows.Close()

	// Collect all unique pets
	type petInfo struct {
		petID   string
		petType string
	}
	var pets []petInfo

	for rows.Next() {
		var p petInfo
		if err := rows.Scan(&p.petID, &p.petType); err != nil {
			span.RecordError(err)
			ErrorWithTrace(ctx, logger, "error", "failed to scan pet row", "err", err)
			return NewInternalError("failed to scan pet data", err)
		}
		pets = append(pets, p)
	}

	if err := rows.Err(); err != nil {
		span.RecordError(err)
		ErrorWithTrace(ctx, logger, "error", "error iterating pet rows", "err", err)
		return NewInternalError("error iterating pet rows", err)
	}

	InfoWithTrace(ctx, logger, "action", "pets_to_reset", "count", len(pets))

	// Use goroutines to reset availability for each pet concurrently
	var wg sync.WaitGroup
	errChan := make(chan error, len(pets))

	for _, pet := range pets {
		wg.Add(1)
		go func(p petInfo) {
			defer wg.Done()
			// Reset availability to "yes" to make pets available again
			req := completeAdoptionRequest{
				PetId:           p.petID,
				PetType:         p.petType,
				PetAvailability: "yes",
			}
			if err := r.callPetUpdater(ctx, req); err != nil {
				ErrorWithTrace(ctx, logger, "error", "failed to reset pet availability", "petID", p.petID, "petType", p.petType, "err", err)
				errChan <- err
			} else {
				InfoWithTrace(ctx, logger, "action", "pet_availability_reset", "petID", p.petID, "petType", p.petType)
			}
		}(pet)
	}

	// Wait for all goroutines to complete
	wg.Wait()
	close(errChan)

	// Check if any errors occurred
	var resetErrors []error
	for err := range errChan {
		resetErrors = append(resetErrors, err)
	}

	if len(resetErrors) > 0 {
		ErrorWithTrace(ctx, logger, "error", "some pets failed to reset", "errorCount", len(resetErrors))
		return NewInternalError(fmt.Sprintf("failed to reset %d pets", len(resetErrors)), resetErrors[0])
	}

	InfoWithTrace(ctx, logger, "action", "all_pets_reset_successfully", "count", len(pets))
	return nil
}

type Pet struct {
	Availability string `dynamo:"availability"`
	CutenessRate string `json:"cuteness_rate" dynamo:"cuteness_rate"`
	PetColor     string `dynamo:"petcolor,"`
	PetID        string `dynamo:"petid"`
	PetType      string `dynamo:"pettype"`
	Image        string `dynamo:"image"`
	Price        string `dynamo:"price"`
}

func (r *repo) TriggerSeeding(ctx context.Context) error {
	span := trace.SpanFromContext(ctx)
	ctx, ddbSpan := r.cfg.Tracer.Start(ctx, "DDB seed")

	seedRawData, err := r.fetchSeedData()

	if err != nil {
		ErrorWithTrace(ctx, r.logger, "err", err)
		span.RecordError(err)
		return err
	}

	var pets []Pet

	if err := json.Unmarshal([]byte(seedRawData), &pets); err != nil {
		ErrorWithTrace(ctx, r.logger, "err", err)
		span.RecordError(err)
		return err
	}

	var awsCfg aws.Config
	if r.cfg.DDBInterfaceEndpoint != "" {
		awsCfg = r.cfg.AWSCfg.Copy()
		awsCfg.BaseEndpoint = aws.String(r.cfg.DDBInterfaceEndpoint)
	} else {
		awsCfg = r.cfg.AWSCfg
	}
	db := dynamo.New(awsCfg)
	table := db.Table(r.cfg.DynamoDBTable)

	bw := table.Batch().Write()
	for _, i := range pets {
		bw = bw.Put(i)
	}

	res, err := bw.Run(ctx)

	r.logger.Log("res", res, "err", err)
	ddbSpan.End()

	ctx, pgSpan := r.cfg.Tracer.Start(ctx, "PG create tables")
	defer pgSpan.End()
	sqlErr := r.CreateSQLTables(ctx)
	if sqlErr != nil {
		span.RecordError(sqlErr)
		return sqlErr
	}

	return nil

}

func (r *repo) fetchSeedData() (string, error) {

	data, err := os.ReadFile("seed.json")
	if err != nil {
		r.logger.Log("err", err)
	}

	return string(data), nil
}

func (r *repo) ErrorModeOn(ctx context.Context) bool {

	svc := ssm.NewFromConfig(r.cfg.AWSCfg)

	res, err := svc.GetParameter(ctx, &ssm.GetParameterInput{
		Name: aws.String("/petstore/errormode1"),
	})

	if err != nil {
		return false
	}

	return aws.ToString(res.Parameter.Value) == "true"
}

func (r *repo) CreateSQLTables(ctx context.Context) error {
	// cSpell:ignore VARCHAR
	sql := `CREATE TABLE IF NOT EXISTS transactions (
		id SERIAL PRIMARY KEY,
		pet_id VARCHAR,
		pet_type VARCHAR,
		adoption_date DATE,
		transaction_id VARCHAR,
		user_id VARCHAR
	);`

	r.logger.Log("sql", sql)
	_, err := r.db.ExecContext(ctx, sql)
	if err != nil {
		return err
	}

	return nil
}

// GetConnectionString retrieves the database connection string for error mode scenarios
func (r *repo) GetConnectionString(ctx context.Context) (string, error) {
	return r.dbSvc.GetConnectionString(ctx)
}
