package petlistadoptions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/aws/aws-xray-sdk-go/xray"
	"github.com/go-kit/kit/log"
	"github.com/go-kit/kit/transport"
	httptransport "github.com/go-kit/kit/transport/http"
)

func MakeHTTPHandler(s Service, logger log.Logger) http.Handler {
	r := mux.NewRouter()
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

	// using xray as wrapper for http.Handler
	r.Methods("GET").Path("/api/adoptionlist/").Handler(
		xray.Handler(
			xray.NewFixedSegmentNamer("petlistadoptions"),
			httptransport.NewServer(
				e.ListAdoptionsEndpoint,
				decodeEmptyRequest,
				encodeResponse,
				options...,
			),
		),
	)

	return r
}

type errorer interface {
	error() error
}

var (
	ErrNotFound   = errors.New("not found")
	ErrBadRequest = errors.New("bad request parameters")
)

func decodeEmptyRequest(_ context.Context, r *http.Request) (interface{}, error) {
	return nil, nil
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
