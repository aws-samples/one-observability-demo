package main

import (
	"context"
	"fmt"
	"io/ioutil"
	"net/http"
	"sync"
	"time"

	"github.com/dghubble/sling"
	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/log/level"
	"github.com/gofrs/uuid"
)

// links endpoints to transport
type Service interface {
	HealthCheck(ctx context.Context) (string, error)
	CompleteAdoption(ctx context.Context, petId, petType string) (Adoption, error)
}

// object that handles the logic and complies with interface
type service struct {
	logger     log.Logger
	repository Repository
}

//inject dependencies into core logic
func NewService(logger log.Logger, rep Repository) Service {
	return &service{
		logger:     logger,
		repository: rep,
	}
}

// health check logic
func (s service) HealthCheck(ctx context.Context) (string, error) {
	return "alive", nil
}

// /api/completeadoption logic
func (s service) CompleteAdoption(ctx context.Context, petId, petType string) (Adoption, error) {
	logger := log.With(s.logger, "method", "CompleteAdoption")

	uuid, _ := uuid.NewV4()
	a := Adoption{
		TransactionID: uuid.String(),
		PetID:         petId,
		PetType:       petType,
		AdoptionDate:  time.Now(),
	}

	logger.Log(
		"traceId", "xray Trace to retrieve",
		"transaction", fmt.Sprintf("%#v", a),
	)

	if err := s.repository.CreateTransaction(ctx, a); err != nil {
		level.Error(logger).Log("err", err)
		return Adoption{}, err
	}

	return a, s.updateAvailability("https://s0b8q2ju3b.execute-api.eu-west-1.amazonaws.com/prod/", a)
}

func (s service) updateAvailability(updateAdoptionURL string, a Adoption) error {
	logger := log.With(s.logger, "method", "updateAvailability")

	errs := make(chan error)
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {

		defer wg.Done()
		client := &http.Client{}

		body := &completeAdoptionRequest{a.PetID, a.PetType}
		req, _ := sling.New().Put(updateAdoptionURL).BodyJSON(body).Request()
		resp, err := client.Do(req)
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
			fmt.Println(sb)
		}
		//log.Printf(sb)
	}()

	go func() {
		_, err := http.Get("https://amazon.com")
		if err != nil {
			level.Error(logger).Log("err", err)
			errs <- err
		}
		wg.Done()
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
