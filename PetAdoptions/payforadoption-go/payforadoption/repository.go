package payforadoption

import (
	"context"
	"database/sql"
	"errors"
	"io/ioutil"
	"net/http"
	"sync"

	"github.com/aws/aws-xray-sdk-go/xray"
	"github.com/dghubble/sling"
	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
)

// Repository as an interface to define data store interactions
type Repository interface {
	CreateTransaction(ctx context.Context, a Adoption) error
	DropTransactions(ctx context.Context) error
	UpdateAvailability(ctx context.Context, a Adoption, updateAdoptionURL string) error
}

var RepoErr = errors.New("Unable to handle Repo Request")

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

func (r *repo) CreateTransaction(ctx context.Context, a Adoption) error {

	sql := `
		INSERT INTO dbo.transactions (PetId, Transaction_Id, Adoption_Date)
		VALUES (@p1, @p2, @p3)
	`

	r.logger.Log("sql", sql)
	_, err := r.db.ExecContext(ctx, sql, a.PetID, a.TransactionID, a.AdoptionDate)
	if err != nil {
		return err
	}
	return nil
}

func (r *repo) DropTransactions(ctx context.Context) error {

	sql := `DELETE FROM dbo.transactions`

	r.logger.Log("sql", sql)
	_, err := r.db.ExecContext(ctx, sql)
	if err != nil {
		return err
	}
	return nil
}

func (r *repo) UpdateAvailability(ctx context.Context, a Adoption, updateAdoptionURL string) error {
	logger := log.With(r.logger, "method", "UpdateAvailability")
	subsegCtx, subseg := xray.BeginSubsegment(ctx, "UpdateAvailability")
	defer subseg.Close(nil)

	errs := make(chan error)
	var wg sync.WaitGroup
	wg.Add(2)

	// using xray as a wrapper for http client
	client := xray.Client(&http.Client{})

	go func() {
		defer wg.Done()

		updateAdoptionStatusCtx, updateAdoptionStatusSeg := xray.BeginSubsegment(
			subsegCtx,
			"Update Adoption Status",
		)
		defer updateAdoptionStatusSeg.Close(nil)

		body := &completeAdoptionRequest{a.PetID, a.PetType}
		req, _ := sling.New().Put(updateAdoptionURL).BodyJSON(body).Request()
		resp, err := client.Do(req.WithContext(updateAdoptionStatusCtx))
		if err != nil {
			level.Error(logger).Log("err", err)
			errs <- err
			return
		}

		defer resp.Body.Close()
		if body, err := ioutil.ReadAll(resp.Body); err != nil {
			level.Error(logger).Log("err", err)
			errs <- err
		} else {
			sb := string(body)
			logger.Log(sb)
		}
	}()

	go func() {
		defer wg.Done()

		availabilityCtx, availabilitySeg := xray.BeginSubsegment(
			subsegCtx,
			"Invoking Availability API",
		)
		defer availabilitySeg.Close(nil)

		req, _ := http.NewRequest("GET", "https://amazon.com", nil)
		_, err := client.Do(req.WithContext(availabilityCtx))
		if err != nil {
			level.Error(logger).Log("err", err)
			errs <- err
		}
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
