/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"context"
	"fmt"

	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	"go.opentelemetry.io/otel/trace"
)

// TracingLogger wraps a go-kit logger and automatically adds trace IDs to log entries
type TracingLogger struct {
	logger log.Logger
}

// NewTracingLogger creates a new tracing logger that automatically adds trace IDs
func NewTracingLogger(logger log.Logger) *TracingLogger {
	return &TracingLogger{
		logger: logger,
	}
}

// WithTraceID extracts the trace ID from context and adds it to the logger
func (tl *TracingLogger) WithTraceID(ctx context.Context) log.Logger {
	traceID := extractTraceID(ctx)
	if traceID != "" {
		return log.With(tl.logger, "trace_id", traceID)
	}
	return tl.logger
}

// Info logs an info message with trace ID from context
func (tl *TracingLogger) Info(ctx context.Context, keyvals ...interface{}) error {
	logger := tl.WithTraceID(ctx)
	return level.Info(logger).Log(keyvals...)
}

// Error logs an error message with trace ID from context
func (tl *TracingLogger) Error(ctx context.Context, keyvals ...interface{}) error {
	logger := tl.WithTraceID(ctx)
	return level.Error(logger).Log(keyvals...)
}

// Debug logs a debug message with trace ID from context
func (tl *TracingLogger) Debug(ctx context.Context, keyvals ...interface{}) error {
	logger := tl.WithTraceID(ctx)
	return level.Debug(logger).Log(keyvals...)
}

// Warn logs a warning message with trace ID from context
func (tl *TracingLogger) Warn(ctx context.Context, keyvals ...interface{}) error {
	logger := tl.WithTraceID(ctx)
	return level.Warn(logger).Log(keyvals...)
}

// Log logs a message with trace ID from context (basic logging)
func (tl *TracingLogger) Log(ctx context.Context, keyvals ...interface{}) error {
	logger := tl.WithTraceID(ctx)
	return logger.Log(keyvals...)
}

// extractTraceID extracts the trace ID from the current span context
func extractTraceID(ctx context.Context) string {
	span := trace.SpanFromContext(ctx)
	if !span.IsRecording() {
		return ""
	}

	spanContext := span.SpanContext()
	if !spanContext.IsValid() {
		return ""
	}

	// Return trace ID in the format you specified (32 hex characters)
	return spanContext.TraceID().String()
}

// Convenience functions for fmt.Printf replacement with trace ID

// InfoWithTrace replaces fmt.Printf with structured logging including trace ID
func InfoWithTrace(ctx context.Context, format string, args ...interface{}) {
	traceID := extractTraceID(ctx)
	message := fmt.Sprintf(format, args...)

	if traceID != "" {
		fmt.Printf("[INFO] trace_id=%s %s", traceID, message)
	} else {
		fmt.Printf("[INFO] %s", message)
	}
}

// ErrorWithTrace replaces fmt.Printf for errors with structured logging including trace ID
func ErrorWithTrace(ctx context.Context, format string, args ...interface{}) {
	traceID := extractTraceID(ctx)
	message := fmt.Sprintf(format, args...)

	if traceID != "" {
		fmt.Printf("[ERROR] trace_id=%s %s", traceID, message)
	} else {
		fmt.Printf("[ERROR] %s", message)
	}
}

// WarnWithTrace replaces fmt.Printf for warnings with structured logging including trace ID
func WarnWithTrace(ctx context.Context, format string, args ...interface{}) {
	traceID := extractTraceID(ctx)
	message := fmt.Sprintf(format, args...)

	if traceID != "" {
		fmt.Printf("[WARN] trace_id=%s %s", traceID, message)
	} else {
		fmt.Printf("[WARN] %s", message)
	}
}

// DebugWithTrace replaces fmt.Printf for debug with structured logging including trace ID
func DebugWithTrace(ctx context.Context, format string, args ...interface{}) {
	traceID := extractTraceID(ctx)
	message := fmt.Sprintf(format, args...)

	if traceID != "" {
		fmt.Printf("[DEBUG] trace_id=%s %s", traceID, message)
	} else {
		fmt.Printf("[DEBUG] %s", message)
	}
}
