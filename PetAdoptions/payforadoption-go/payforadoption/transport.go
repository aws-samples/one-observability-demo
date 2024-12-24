package payforadoption

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/transport"
	httptransport "github.com/go-kit/kit/transport/http"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux"
)

func MakeHTTPHandler(s Service, logger log.Logger) http.Handler {
	r := mux.NewRouter()

	r.Use(otelmux.Middleware("payforadoption",
		otelmux.WithFilter(func(r *http.Request) bool {
			switch r.URL.Path {
			// case "/health/status":
			// 	return false
			case "/metrics":
				return false
			default:
				return true
			}
		}),
	))

	e := MakeEndpoints(s)
	options := []httptransport.ServerOption{
		httptransport.ServerErrorHandler(transport.NewLogErrorHandler(logger)),
		httptransport.ServerErrorEncoder(encodeError),
		httptransport.ServerFinalizer(loggingMiddleware),
	}

	r.Methods("GET").Path("/health/status").Handler(httptransport.NewServer(
		e.HealthCheckEndpoint,
		decodeEmptyRequest,
		encodeEmptyResponse,
		options...,
	))

	r.Methods("POST").Path("/api/home/completeadoption").Handler(httptransport.NewServer(
		e.CompleteAdoptionEndpoint,
		decodeCompleteAdoptionRequest,
		encodeResponse,
		options...,
	))

	r.Methods("POST").Path("/api/home/cleanupadoptions").Handler(httptransport.NewServer(
		e.CleanupAdoptionsEndpoint,
		decodeEmptyRequest,
		encodeEmptyResponse,
		options...,
	))

	// Trigger DDB seeding
	r.Methods("POST").Path("/api/home/triggerseeding").Handler(httptransport.NewServer(
		e.TriggerSeedingEndpoint,
		decodeEmptyRequest,
		encodeEmptyResponse,
		options...,
	))

	r.Methods("GET").Path("/metrics").Handler(promhttp.Handler())

	return r
}

type errorer interface {
	error() error
}

type completeAdoptionRequest struct {
	PetId   string `json:"petid"`
	PetType string `json:"pettype"`
}

var (
	ErrNotFound   = errors.New("not found")
	ErrBadRequest = errors.New("Bad request parameters")
)

func decodeEmptyRequest(_ context.Context, r *http.Request) (interface{}, error) {
	return nil, nil
}

func decodeCompleteAdoptionRequest(_ context.Context, r *http.Request) (interface{}, error) {

	petId := r.URL.Query().Get("petId")
	petType := r.URL.Query().Get("petType")

	if petId == "" || petType == "" {
		return nil, ErrBadRequest
	}

	return completeAdoptionRequest{petId, petType}, nil
}

func encodeResponse(ctx context.Context, w http.ResponseWriter, response interface{}) error {
	if e, ok := response.(errorer); ok && e.error() != nil {
		encodeError(ctx, e.error(), w)
		return nil
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(response)
}

func encodeEmptyResponse(ctx context.Context, w http.ResponseWriter, response interface{}) error {
	if e, ok := response.(errorer); ok && e.error() != nil {
		encodeError(ctx, e.error(), w)
		return nil
	}
	return nil
}

func encodeError(_ context.Context, err error, w http.ResponseWriter) {
	if err == nil {
		panic("encodeError with nil error")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(codeFrom(err))
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": err.Error(),
	})
}

func codeFrom(err error) int {
	switch err {
	case ErrNotFound:
		return http.StatusNotFound
	case ErrBadRequest:
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func loggingMiddleware(ctx context.Context, code int, r *http.Request) {
	fmt.Println(r.Method, r.RequestURI, r.Proto, r.RemoteAddr, code)
}
