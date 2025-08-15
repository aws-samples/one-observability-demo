/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

//region imports and http error handling

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws/credentials"
	v4 "github.com/aws/aws-sdk-go/aws/signer/v4"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrBadRequest = errors.New("bad request parameters")
)

type errorer interface {
	error() error
}

func encodeResponse(ctx context.Context, w http.ResponseWriter, response interface{}) error {
	if e, ok := response.(errorer); ok && e.error() != nil {
		encodeError(ctx, e.error(), w)
		return nil
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	return json.NewEncoder(w).Encode(response)
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

func logError(err error, message string, log *zap.SugaredLogger, span trace.Span) {
	if err != nil {
		if span == nil {
			log.Errorw(message,
				"err", err,
			)
		} else {
			log.Errorw(message,
				"err", err,
				"xrayTraceID", getXrayTraceID(span),
			)
		}
	}
}

type defaultTransportRT struct {
	log *zap.SugaredLogger
}

func (t *defaultTransportRT) RoundTrip(req *http.Request) (*http.Response, error) {
	transport := http.DefaultTransport

	t.log.Debugw("",
		"request headers", req.Header,
	)
	t.log.Debugw("",
		"context", req.Context(),
	)

	resp, err := transport.RoundTrip(req)
	return resp, err
}

//#endregion imports and http error handling

func query(ctx context.Context, cfg *Config, method string, url string, data io.ReadCloser) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, url, data)
	logError(err, "failed creating request", cfg.log, nil)

	client := http.Client{
		Transport: otelhttp.NewTransport(&defaultTransportRT{cfg.log}),
		Timeout:   5 * time.Second,
	}
	return client.Do(request)
}

func signedQuery(ctx context.Context, cfg *Config, method string, url string, data io.ReadCloser) (*http.Response, error) {
	//#region signed query
	request, err := http.NewRequestWithContext(ctx, method, url, data)
	logError(err, "failed creating request", cfg.log, nil)

	// need fresh credentials as AWS session token can expired
	credsValue, err := cfg.sess.Config.Credentials.Get()
	logError(err, "failed creating session", cfg.log, nil)

	credentials := credentials.NewStaticCredentialsFromCreds(credsValue)
	signer := v4.NewSigner(credentials)

	b, _ := io.ReadAll(data)
	cfg.log.Debug(string(b))

	signer.Sign(request, strings.NewReader(string(b)), "lambda", cfg.dataAPIRegion, time.Now())
	//#endregion signed query
	client := http.Client{
		Transport: otelhttp.NewTransport(&defaultTransportRT{cfg.log}),
		Timeout:   5 * time.Second,
	}
	return client.Do(request)

}

func getXrayTraceID(span trace.Span) string {
	if span == nil {
		return ""
	}
	xrayTraceID := span.SpanContext().TraceID().String()
	result := fmt.Sprintf("1-%s-%s", xrayTraceID[0:8], xrayTraceID[8:])
	return result
}
