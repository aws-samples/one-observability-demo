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
	"github.com/go-kit/log/level"
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
	TriggerSeeding(ctx context.Context) error
	CreateSQLTables(ctx context.Context) error
	ErrorModeOn(ctx context.Context) bool
	GetConnectionString(ctx context.Context) (string, error)
}

type Config struct {
	UpdateAdoptionURL string
	RDSSecretArn      string
	S3BucketName      string
	DynamoDBTable     string
	SQSQueueURL       string
	AWSRegion         string
	Tracer            trace.Tracer
	AWSCfg            aws.Config
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

	sql := `INSERT INTO transactions (pet_id, adoption_date, transaction_id, user_id) VALUES ($1, $2, $3, $4)`

	r.logger.Log("sql", sql)
	_, err := r.db.ExecContext(ctx, sql, a.PetID, a.AdoptionDate, a.TransactionID, a.UserID)
	if err != nil {
		span.RecordError(err)
		level.Error(r.logger).Log("error", "failed to create transaction", "err", err)
		return err
	}

	level.Info(r.logger).Log(
		"action", "transaction_created",
		"transactionId", a.TransactionID,
		"petId", a.PetID,
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
		level.Error(r.logger).Log("error", "failed to marshal history message", "err", err)
		return err
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
		level.Error(r.logger).Log("error", "failed to send history message to SQS", "err", err, "queueUrl", r.cfg.SQSQueueURL)
		return err
	}

	level.Info(r.logger).Log(
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
	span.AddEvent("removing transactions in PG DB")

	sql := `DELETE FROM transactions`

	r.logger.Log("sql", sql)
	_, err := r.db.ExecContext(ctx, sql)
	if err != nil {
		span.RecordError(err)
		return err
	}

	return nil
}

func (r *repo) UpdateAvailability(ctx context.Context, a Adoption) error {
	logger := log.With(r.logger, "method", "UpdateAvailability")
	ctx, parentSpan := r.cfg.Tracer.Start(ctx, "UpdateAvailability")
	defer parentSpan.End()

	errs := make(chan error)
	var wg sync.WaitGroup
	wg.Add(2)

	// using xray as a wrapper for http client
	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport), Timeout: 5 * time.Second}

	go func() {
		defer wg.Done()
		updateAdoptionStatusCtx, updateAdoptionStatusSpan := r.cfg.Tracer.Start(ctx, "Update Adoption Status")
		defer updateAdoptionStatusSpan.End()

		body := &completeAdoptionRequest{a.PetID, a.PetType, a.UserID}
		req, _ := sling.New().Put(r.cfg.UpdateAdoptionURL).BodyJSON(body).Request()
		resp, err := client.Do(req.WithContext(updateAdoptionStatusCtx))
		if err != nil {
			level.Error(logger).Log("err", err)
			updateAdoptionStatusSpan.RecordError(err)
			errs <- err
			return
		}

		defer resp.Body.Close()
		if body, err := io.ReadAll(resp.Body); err != nil {
			level.Error(logger).Log("err", err)
			updateAdoptionStatusSpan.RecordError(err)
			errs <- err
		} else {
			sb := string(body)
			logger.Log(sb)
		}
	}()

	go func() {
		defer wg.Done()
		availabilityCtx, availabilitySpan := r.cfg.Tracer.Start(ctx, "Invoking Availability API")
		defer availabilitySpan.End()

		client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport), Timeout: 5 * time.Second}
		request, err := http.NewRequestWithContext(availabilityCtx, http.MethodGet, "https://amazon.com", nil)
		if err != nil {
			level.Error(logger).Log("err", err)
			availabilitySpan.RecordError(err)
			errs <- err
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
		level.Error(r.logger).Log("err", err)
		span.RecordError(err)
		return err
	}

	var pets []Pet

	if err := json.Unmarshal([]byte(seedRawData), &pets); err != nil {
		level.Error(r.logger).Log("err", err)
		span.RecordError(err)
		return err
	}

	db := dynamo.New(r.cfg.AWSCfg)
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
