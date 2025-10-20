/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package payforadoption

import (
	"context"

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
	traceID := ExtractTraceID(ctx)
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

// ExtractTraceID extracts the trace ID from the current span context
func ExtractTraceID(ctx context.Context) string {
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

// WithTraceIDFromContext is a utility function to add trace ID to any go-kit logger
func WithTraceIDFromContext(ctx context.Context, logger log.Logger) log.Logger {
	traceID := ExtractTraceID(ctx)
	if traceID != "" {
		return log.With(logger, "trace_id", traceID)
	}
	return logger
}

// Convenience functions for structured logging with trace ID

// InfoWithTrace logs an info message with trace ID
func InfoWithTrace(ctx context.Context, logger log.Logger, keyvals ...interface{}) error {
	tracingLogger := WithTraceIDFromContext(ctx, logger)
	return level.Info(tracingLogger).Log(keyvals...)
}

// ErrorWithTrace logs an error message with trace ID
func ErrorWithTrace(ctx context.Context, logger log.Logger, keyvals ...interface{}) error {
	tracingLogger := WithTraceIDFromContext(ctx, logger)
	return level.Error(tracingLogger).Log(keyvals...)
}

// DebugWithTrace logs a debug message with trace ID
func DebugWithTrace(ctx context.Context, logger log.Logger, keyvals ...interface{}) error {
	tracingLogger := WithTraceIDFromContext(ctx, logger)
	return level.Debug(tracingLogger).Log(keyvals...)
}

// WarnWithTrace logs a warning message with trace ID
func WarnWithTrace(ctx context.Context, logger log.Logger, keyvals ...interface{}) error {
	tracingLogger := WithTraceIDFromContext(ctx, logger)
	return level.Warn(tracingLogger).Log(keyvals...)
}

// LogWithTrace logs a message with trace ID
func LogWithTrace(ctx context.Context, logger log.Logger, keyvals ...interface{}) error {
	tracingLogger := WithTraceIDFromContext(ctx, logger)
	return tracingLogger.Log(keyvals...)
}
