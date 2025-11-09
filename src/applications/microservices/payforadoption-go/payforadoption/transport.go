/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package payforadoption

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/go-kit/kit/transport"
	httptransport "github.com/go-kit/kit/transport/http"
	"github.com/go-kit/log"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gorilla/mux/otelmux"
	"go.opentelemetry.io/otel/trace"
)

func MakeHTTPHandler(s Service, logger log.Logger) http.Handler {
	r := mux.NewRouter()

	r.Use(otelmux.Middleware("payforadoption",
		otelmux.WithFilter(func(r *http.Request) bool {
			switch r.URL.Path {
			case "/health/status":
				// instrumenting health check endpoint for application signals
				return true
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

	r.Methods("POST").Path("/api/completeadoption").Handler(httptransport.NewServer(
		e.CompleteAdoptionEndpoint,
		decodeCompleteAdoptionRequest,
		encodeResponse,
		options...,
	))

	r.Methods("DELETE").Path("/api/cleanupadoptions/{userId}").Handler(httptransport.NewServer( // cSpell:ignore cleanupadoptions // cSpell:ignore cleanupadoptions // cSpell:ignore cleanupadoptions // cSpell:ignore cleanupadoptions
		e.CleanupAdoptionsEndpoint,
		decodeCleanupAdoptionsRequest,
		encodeEmptyResponse,
		options...,
	))

	// Trigger DDB seeding
	r.Methods("POST").Path("/api/triggerseeding").Handler(httptransport.NewServer(
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
	PetId   string `json:"petid" url:"petid"`
	PetType string `json:"pettype" url:"pettype"`
	UserID  string `json:"userid" url:"userid"`
}

type cleanupAdoptionsRequest struct {
	UserID string `json:"userid"`
}

func decodeEmptyRequest(_ context.Context, r *http.Request) (interface{}, error) {
	return nil, nil
}

func decodeCompleteAdoptionRequest(_ context.Context, r *http.Request) (interface{}, error) {

	petId := r.URL.Query().Get("petId")
	petType := r.URL.Query().Get("petType")
	userID := r.URL.Query().Get("userId")

	if petId == "" || petType == "" || userID == "" {
		return nil, ErrBadRequest
	}

	return completeAdoptionRequest{petId, petType, userID}, nil
}

func decodeCleanupAdoptionsRequest(_ context.Context, r *http.Request) (interface{}, error) {
	vars := mux.Vars(r)
	userID := vars["userId"]

	if userID == "" {
		return nil, ErrBadRequest
	}

	return cleanupAdoptionsRequest{userID}, nil
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
	// Check if error implements HTTPStatusCode method
	if svcErr, ok := err.(ServiceError); ok {
		return svcErr.HTTPStatusCode()
	}

	// Legacy error handling for backward compatibility
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
	// Extract trace ID from context
	traceID := extractTraceIDFromContext(ctx)
	if traceID != "" {
		fmt.Printf("[INFO] trace_id=%s %s %s %s %s %d\n", traceID, r.Method, r.RequestURI, r.Proto, r.RemoteAddr, code)
	} else {
		fmt.Printf("[INFO] %s %s %s %s %d\n", r.Method, r.RequestURI, r.Proto, r.RemoteAddr, code)
	}
}

// extractTraceIDFromContext extracts the trace ID from the current span context
func extractTraceIDFromContext(ctx context.Context) string {
	span := trace.SpanFromContext(ctx)
	if !span.IsRecording() {
		return ""
	}

	spanContext := span.SpanContext()
	if !spanContext.IsValid() {
		return ""
	}

	// Return trace ID in the format specified (32 hex characters)
	return spanContext.TraceID().String()
}
