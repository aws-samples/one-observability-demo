/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"context"
	"fmt"
	"strings"

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

	// Target database spans (looking for "postgres" spans from otelsql)
	if p.isDatabaseSpan(spanName, s) {
		// Extract SQL operation from existing attributes
		sqlOperation := p.extractSQLOperationFromSpan(s)

		// Add Aurora correlation attributes to the SQL span
		s.SetAttributes(
			// Ensure the service name is preserved
			attribute.String("aws.remote.service", "postgres"),
			// Add Aurora correlation attributes
			attribute.String("aws.remote.resource.identifier", p.resourceIdentifier),
			attribute.String("aws.remote.resource.type", "DB::Connection"),
			attribute.String("aws.remote.operation", sqlOperation), // Set the actual SQL operation
			attribute.String("remote.db.user", p.dbUser),
			attribute.String("remote.resource.cfn.primary.identifier", p.resourceIdentifier),
			// Add database connection string for correlation (sanitized)
			attribute.String("db.connection_string", "localhost/postgres"),
		)

		fmt.Printf("Added Aurora correlation attributes to span: %s with operation: %s\n", spanName, sqlOperation)
	}
}

// OnEnd is called when a span ends
func (p *SQLSpanProcessor) OnEnd(s trace.ReadOnlySpan) {
	// Nothing to do here - all processing happens in OnStart
}

// extractSQLOperation extracts the SQL operation type from a SQL statement
func (p *SQLSpanProcessor) extractSQLOperation(sqlStatement string) string {
	if sqlStatement == "" {
		return "UnknownRemoteOperation"
	}

	// Convert to uppercase and extract the first word (SQL operation)
	sqlUpper := strings.ToUpper(strings.TrimSpace(sqlStatement))

	if strings.HasPrefix(sqlUpper, "INSERT") {
		return "INSERT INTO"
	} else if strings.HasPrefix(sqlUpper, "SELECT") {
		return "SELECT"
	} else if strings.HasPrefix(sqlUpper, "UPDATE") {
		return "UPDATE"
	} else if strings.HasPrefix(sqlUpper, "DELETE") {
		return "DELETE"
	} else if strings.HasPrefix(sqlUpper, "CREATE") {
		return "CREATE"
	} else if strings.HasPrefix(sqlUpper, "DROP") {
		return "DROP"
	} else if strings.HasPrefix(sqlUpper, "ALTER") {
		return "ALTER"
	}

	return "UnknownRemoteOperation"
}

// Shutdown is called when the processor is shut down
func (p *SQLSpanProcessor) Shutdown(ctx context.Context) error {
	return nil
}

// ForceFlush is called to force flush any buffered spans
func (p *SQLSpanProcessor) ForceFlush(ctx context.Context) error {
	return nil
}

// isDatabaseSpan checks if the span is a database span that needs Aurora correlation
func (p *SQLSpanProcessor) isDatabaseSpan(spanName string, s trace.ReadWriteSpan) bool {
	// Check if span name indicates a database operation
	if spanName == "postgres" {
		return true
	}

	// Also check for db.system attribute to identify database spans
	for _, attr := range s.Attributes() {
		if attr.Key == "db.system" && attr.Value.AsString() == "postgres" {
			return true
		}
	}

	return false
}

// extractSQLOperationFromSpan extracts the SQL operation from span attributes
func (p *SQLSpanProcessor) extractSQLOperationFromSpan(s trace.ReadWriteSpan) string {
	// Look for db.statement attribute which contains the SQL query
	for _, attr := range s.Attributes() {
		if attr.Key == "db.statement" {
			sqlStatement := attr.Value.AsString()
			return p.extractSQLOperation(sqlStatement)
		}
	}

	// If no SQL statement found, return unknown operation
	return "UnknownRemoteOperation"
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
