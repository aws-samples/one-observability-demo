/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"context"
	"fmt"

	"petadoptions/payforadoption"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

// SQLSpanProcessor adds Aurora correlation attributes to SQL spans
type SQLSpanProcessor struct {
	resourceIdentifier string
	dbUser             string
	host               string
}

// NewSQLSpanProcessor creates a new SQL span processor with Aurora correlation
func NewSQLSpanProcessor(resourceIdentifier, dbUser, host string) *SQLSpanProcessor {
	return &SQLSpanProcessor{
		resourceIdentifier: resourceIdentifier,
		dbUser:             dbUser,
		host:               host,
	}
}

// OnStart is called when a span starts - this is where we add Aurora correlation attributes
func (p *SQLSpanProcessor) OnStart(parent context.Context, s trace.ReadWriteSpan) {
	spanName := s.Name()

	// Target specific SQL spans that need Aurora correlation
	if p.isSQLSpan(spanName) {
		// Add Aurora correlation attributes to the SQL span
		s.SetAttributes(
			// Ensure the service name is preserved
			attribute.String("aws.remote.service", "postgres"),
			// Add Aurora correlation attributes
			attribute.String("aws.remote.resource.identifier", p.resourceIdentifier),
			attribute.String("aws.remote.resource.type", "DB::Connection"),
			attribute.String("remote.db.user", p.dbUser),
			attribute.String("remote.resource.cfn.primary.identifier", p.resourceIdentifier),
			// Add database connection string for correlation (sanitized)
			attribute.String("db.connection_string", "localhost/postgres"),
			attribute.String("db.system", "postgres"),
		)

		fmt.Printf("Added Aurora correlation attributes to span: %s\n", spanName)
	}
}

// OnEnd is called when a span ends
func (p *SQLSpanProcessor) OnEnd(s trace.ReadOnlySpan) {
	// No additional processing needed on span end
}

// Shutdown is called when the processor is shut down
func (p *SQLSpanProcessor) Shutdown(ctx context.Context) error {
	return nil
}

// ForceFlush is called to force flush any buffered spans
func (p *SQLSpanProcessor) ForceFlush(ctx context.Context) error {
	return nil
}

// isSQLSpan checks if the span is a SQL span that needs Aurora correlation
func (p *SQLSpanProcessor) isSQLSpan(spanName string) bool {
	sqlSpanNames := []string{
		"sql.conn.exec",
		"sql.conn.query",
		"sql.conn.query_row",
		"sql.conn.prepare",
		"sql.conn.reset_session",
	}

	for _, sqlSpan := range sqlSpanNames {
		if spanName == sqlSpan {
			return true
		}
	}

	return false
}

// createSQLSpanProcessor creates and configures the SQL span processor
func createSQLSpanProcessor(ctx context.Context, cfg payforadoption.Config) (*SQLSpanProcessor, error) {
	// Get database configuration for correlation attributes
	dbService := payforadoption.NewDatabaseConfigService(cfg)
	dbConfig, err := dbService.GetDatabaseConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database config for SQL span processor: %w", err)
	}

	// Build resource identifier for Aurora correlation
	resourceIdentifier := fmt.Sprintf("postgres|%s|%d", dbConfig.Host, dbConfig.Port)

	return NewSQLSpanProcessor(resourceIdentifier, dbConfig.Username, dbConfig.Host), nil
}
