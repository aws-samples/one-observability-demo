package payforadoption

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"io/ioutil"
	"net/http"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/ssm"
	"github.com/dghubble/sling"
	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	"github.com/guregu/dynamo"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/trace"
)

// Repository as an interface to define data store interactions
type Repository interface {
	CreateTransaction(ctx context.Context, a Adoption) error
	DropTransactions(ctx context.Context) error
	UpdateAvailability(ctx context.Context, a Adoption) error
	TriggerSeeding(ctx context.Context) error
	CreateSQLTables(ctx context.Context) error
	ErrorModeOn(ctx context.Context) bool
}

type Config struct {
	UpdateAdoptionURL string
	RDSSecretArn      string
	S3BucketName      string
	DynamoDBTable     string
	AWSRegion         string
	Tracer            trace.Tracer
}

var RepoErr = errors.New("Unable to handle Repo Request")

// repo as an implementation of Repository with dependency injection
type repo struct {
	db     *sql.DB
	cfg    Config
	logger log.Logger
}

func NewRepository(db *sql.DB, cfg Config, logger log.Logger) Repository {
	return &repo{
		db:     db,
		cfg:    cfg,
		logger: log.With(logger, "repo", "sql"),
	}
}

func (r *repo) CreateTransaction(ctx context.Context, a Adoption) error {

	sql := `
		INSERT INTO transactions (pet_id, transaction_id, adoption_date)
		VALUES ($1, $2, $3)
	`

	r.logger.Log("sql", sql)
	_, err := r.db.ExecContext(ctx, sql, a.PetID, a.TransactionID, a.AdoptionDate)

	if err != nil {
		return err
	}
	return nil
}

func (r *repo) DropTransactions(ctx context.Context) error {
	sql := []string{`INSERT INTO transactions_history SELECT * FROM transactions`,
		`DELETE FROM transactions`}

	for _, s := range sql {
		r.logger.Log("sql", s)
		_, err := r.db.ExecContext(ctx, s)
		if err != nil {
			return err
		}
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

		body := &completeAdoptionRequest{a.PetID, a.PetType}
		req, _ := sling.New().Put(r.cfg.UpdateAdoptionURL).BodyJSON(body).Request()
		resp, err := client.Do(req.WithContext(updateAdoptionStatusCtx))
		if err != nil {
			level.Error(logger).Log("err", err)
			errs <- err
			return
		}

		defer resp.Body.Close()
		if body, err := io.ReadAll(resp.Body); err != nil {
			level.Error(logger).Log("err", err)
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

	seedRawData, err := r.fetchSeedData()

	if err != nil {
		level.Error(r.logger).Log("err", err)
		return err
	}

	var pets []Pet

	if err := json.Unmarshal([]byte(seedRawData), &pets); err != nil {
		level.Error(r.logger).Log("err", err)
		return err
	}

	db := dynamo.New(session.New(), &aws.Config{Region: aws.String(r.cfg.AWSRegion)})
	table := db.Table(r.cfg.DynamoDBTable)

	bw := table.Batch().Write()
	for _, i := range pets {
		bw = bw.Put(i)
	}

	res, err := bw.Run()

	r.logger.Log("res", res, "err", err)

	sqlErr := r.CreateSQLTables(ctx)
	if sqlErr != nil {
		return sqlErr
	}

	return nil

}

func (r *repo) fetchSeedData() (string, error) {

	//TODO Fetch from s3
	data, err := ioutil.ReadFile("seed.json")
	if err != nil {
		r.logger.Log("err", err)
	}

	return string(data), nil
}

func (r *repo) ErrorModeOn(ctx context.Context) bool {

	svc := ssm.New(session.New(&aws.Config{Region: aws.String(r.cfg.AWSRegion)}))

	res, err := svc.GetParameterWithContext(ctx, &ssm.GetParameterInput{
		Name: aws.String("/petstore/errormode1"),
	})

	if err != nil {
		return false
	}

	if aws.StringValue(res.Parameter.Value) == "true" {
		return true
	}

	return false
}

func (r *repo) CreateSQLTables(ctx context.Context) error {
	sql := []string{
		`CREATE TABLE IF NOT EXISTS transactions (
			id SERIAL PRIMARY KEY,
			pet_id VARCHAR,
			adoption_date DATE,
			transaction_id VARCHAR
		);
		`,
		`CREATE TABLE IF NOT EXISTS transactions_history (
			id SERIAL PRIMARY KEY,
			pet_id VARCHAR,
			adoption_date DATE,
			transaction_id VARCHAR
		);
		`}

	var err error = nil

	for _, s := range sql {
		r.logger.Log("sql", s)
		_, err = r.db.ExecContext(ctx, s)
		if err != nil {
			return err
		}
	}

	return err
}
