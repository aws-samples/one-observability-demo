package petlistadoptions

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	//otelhttp "go.opentelemetry.io/contrib/instrumentation/net/http"
)

// Repository as an interface to define data store interactions
type Repository interface {
	GetLatestAdoptions(ctx context.Context, petSearchURL string) ([]Adoption, error)
}

//repo as an implementation of Repository with dependency injection
type repo struct {
	db     *sql.DB
	logger log.Logger
}

func NewRepository(db *sql.DB, logger log.Logger) Repository {
	return &repo{
		db:     db,
		logger: log.With(logger, "repo", "sql"),
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

	sql := `SELECT TOP 25 PetId, Transaction_Id, Adoption_Date FROM dbo.transactions`

	// TODO: implement when sql context propagation is implemented
	// https://github.com/open-telemetry/opentelemetry-go-contrib/issues/5
	//rows, err := r.db.QueryContext(ctx, sql)
	rows, err := r.db.Query(sql)
	if err != nil {
		logger.Log("error", err)
		return nil, err
	}

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
		logger.Log("petid", i.PetID, "pettype", i.PetType, "petcolor", i.PetColor)
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
