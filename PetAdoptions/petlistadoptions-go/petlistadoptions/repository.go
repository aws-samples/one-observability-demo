package petlistadoptions

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Repository as an interface to define data store interactions
type Repository interface {
	GetLatestAdoptions(ctx context.Context, petSearchURL string) ([]Adoption, error)
}

type Config struct {
	PetSearchURL      string
	RDSSecretArn      string
	RDSReaderEndpoint string
	Tracer            trace.Tracer
	AWSCfg            aws.Config
}

// repo as an implementation of Repository with dependency injection
type repo struct {
	db          *sql.DB
	logger      log.Logger
	safeConnStr string
}

func NewRepository(db *sql.DB, logger log.Logger, safeConnStr string) Repository {
	return &repo{
		db:          db,
		logger:      logger,
		safeConnStr: safeConnStr,
	}
}

type transaction struct {
	TransactionID string
	PetID         string
	AdoptionDate  time.Time
}

type pet struct {
	Availability string `json:"availability,omitempty"`
	CutenessRate string `json:"cuteness_rate,omitempty"`
	PetColor     string `json:"petcolor,omitempty"`
	PetID        string `json:"petid,omitempty"`
	PetType      string `json:"pettype,omitempty"`
	PetURL       string `json:"peturl,omitempty"`
	Price        string `json:"price,omitempty"`
}

func (r *repo) GetLatestAdoptions(ctx context.Context, petSearchURL string) ([]Adoption, error) {
	logger := log.With(r.logger, "method", "GetTopTransactions")

	tracer := otel.GetTracerProvider().Tracer("petlistadoptions")
	_, span := tracer.Start(ctx, "PGSQL Query", trace.WithSpanKind(trace.SpanKindClient))

	sql := `SELECT pet_id, transaction_id, adoption_date FROM transactions ORDER BY id DESC LIMIT 25`
	// TODO: implement native sql instrumentation when issue is closed.
	// https://github.com/open-telemetry/opentelemetry-go-contrib/issues/5
	//rows, err := r.db.QueryContext(ctx, sql)

	span.SetAttributes(
		attribute.String("sql", sql),
		attribute.String("url", r.safeConnStr),
	)

	rows, err := r.db.Query(sql)
	if err != nil {
		logger.Log("error", err)
		return nil, err
	}
	span.End()

	var wg sync.WaitGroup
	adoptions := make(chan Adoption)

	for rows.Next() {
		t := transaction{}

		err := rows.Scan(&t.PetID, &t.TransactionID, &t.AdoptionDate)

		if err != nil {
			level.Error(logger).Log("err", err)
			continue
		}
		wg.Add(1)
		go searchForPet(ctx, r.logger, &wg, adoptions, t, petSearchURL)
	}

	go func() {
		wg.Wait()
		close(adoptions)
	}()

	res := []Adoption{}

	for i := range adoptions {
		logger.Log("petid", i.PetID, "pettype", i.PetType, "petcolor", i.PetColor, "xrayTraceId", getXrayTraceID(span))
		res = append(res, i)
	}

	return res, nil
}

func searchForPet(ctx context.Context, logger log.Logger, wg *sync.WaitGroup, queue chan Adoption, t transaction, petSearchURL string) {
	logger = log.With(logger, "method", "searchForPet", "petid", t.PetID)
	defer wg.Done()

	url := fmt.Sprintf("%spetid=%s", petSearchURL, t.PetID)

	client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}

	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := client.Do(req)
	if err != nil {
		level.Error(logger).Log("err", err)
		return
	}

	pets := []pet{}
	err = json.NewDecoder(resp.Body).Decode(&pets)
	if err != nil {
		level.Error(logger).Log("err", err)
		return
	}

	for _, p := range pets {
		// Merging elements from response. Result for petsearch is return as array

		queue <- Adoption{
			AdoptionDate:  t.AdoptionDate,
			Availability:  p.Availability,
			CutenessRate:  p.CutenessRate,
			PetColor:      p.PetColor,
			PetID:         p.PetID,
			PetType:       p.PetType,
			PetURL:        p.PetURL,
			Price:         p.Price,
			TransactionID: t.TransactionID,
		}
	}
}
