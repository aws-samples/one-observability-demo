/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/go-kit/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

func TestTracingLogger(t *testing.T) {
	// Create a buffer to capture log output
	var buf bytes.Buffer
	logger := log.NewJSONLogger(&buf)

	// Create tracing logger
	tracingLogger := NewTracingLogger(logger)

	// Test without active span (no trace ID should be added)
	ctx := context.Background()
	err := tracingLogger.Info(ctx, "message", "test without trace")
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	logOutput := buf.String()
	if strings.Contains(logOutput, "trace_id") {
		t.Errorf("Expected no trace_id in log without active span, got: %s", logOutput)
	}

	// Reset buffer
	buf.Reset()

	// Test with active span (trace ID should be added)
	tp := trace.NewTracerProvider()
	otel.SetTracerProvider(tp)
	tracer := tp.Tracer("test")

	ctx, span := tracer.Start(context.Background(), "test-span")
	defer span.End()

	err = tracingLogger.Info(ctx, "message", "test with trace")
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	logOutput = buf.String()
	if !strings.Contains(logOutput, "trace_id") {
		t.Errorf("Expected trace_id in log with active span, got: %s", logOutput)
	}

	// Verify trace ID format (should be 32 hex characters)
	traceID := extractTraceID(ctx)
	if len(traceID) != 32 {
		t.Errorf("Expected trace ID to be 32 characters, got %d: %s", len(traceID), traceID)
	}

	// Verify trace ID contains only hex characters
	for _, char := range traceID {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			t.Errorf("Expected trace ID to contain only hex characters, got: %s", traceID)
			break
		}
	}
}

func TestExtractTraceID(t *testing.T) {
	// Test with no span context
	ctx := context.Background()
	traceID := extractTraceID(ctx)
	if traceID != "" {
		t.Errorf("Expected empty trace ID with no span context, got: %s", traceID)
	}

	// Test with noop tracer (should return empty)
	noopTracer := noop.NewTracerProvider().Tracer("test")
	ctx, span := noopTracer.Start(context.Background(), "test-span")
	defer span.End()

	traceID = extractTraceID(ctx)
	if traceID != "" {
		t.Errorf("Expected empty trace ID with noop tracer, got: %s", traceID)
	}

	// Test with real tracer
	tp := trace.NewTracerProvider()
	realTracer := tp.Tracer("test")
	ctx, span = realTracer.Start(context.Background(), "test-span")
	defer span.End()

	traceID = extractTraceID(ctx)
	if traceID == "" {
		t.Error("Expected non-empty trace ID with real tracer")
	}

	if len(traceID) != 32 {
		t.Errorf("Expected trace ID to be 32 characters, got %d: %s", len(traceID), traceID)
	}
}

func TestConvenienceFunctions(t *testing.T) {

	// Create tracer and span
	tp := trace.NewTracerProvider()
	otel.SetTracerProvider(tp)
	tracer := tp.Tracer("test")

	ctx, span := tracer.Start(context.Background(), "test-span")
	defer span.End()

	// Test InfoWithTrace - this writes to stdout, so we just verify it doesn't panic
	InfoWithTrace(ctx, "Test info message with trace ID: %s\n", "test")

	// Test ErrorWithTrace - this writes to stdout, so we just verify it doesn't panic
	ErrorWithTrace(ctx, "Test error message: %s\n", "error")

	// Test WarnWithTrace
	WarnWithTrace(ctx, "Test warning message: %s\n", "warning")

	// Test DebugWithTrace
	DebugWithTrace(ctx, "Test debug message: %s\n", "debug")

	// If we get here without panicking, the test passes
	t.Log("All convenience functions executed successfully")
}
