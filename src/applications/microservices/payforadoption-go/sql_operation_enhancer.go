/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"context"
	"fmt"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

// SQLOperationEnhancer is a span processor that enhances SQL spans with proper operation names
type SQLOperationEnhancer struct {
	resourceIdentifier string
	dbUser             string
	host               string
}

// NewSQLOperationEnhancer creates a new SQL operation enhancer
func NewSQLOperationEnhancer(resourceIdentifier, dbUser, host string) *SQLOperationEnhancer {
	return &SQLOperationEnhancer{
		resourceIdentifier: resourceIdentifier,
		dbUser:             dbUser,
		host:               host,
	}
}

// OnStart is called when a span starts
func (e *SQLOperationEnhancer) OnStart(parent context.Context, s trace.ReadWriteSpan) {
	spanName := s.Name()

	// Target SQL spans that need enhancement
	if e.isSQLSpan(spanName) {
		// Add Aurora correlation attributes
		s.SetAttributes(
			// Ensure the service name is preserved
			attribute.String("aws.remote.service", "postgres"),
			// Add Aurora correlation attributes
			attribute.String("aws.remote.resource.identifier", e.resourceIdentifier),
			attribute.String("aws.remote.resource.type", "DB::Connection"),
			attribute.String("remote.db.user", e.dbUser),
			attribute.String("remote.resource.cfn.primary.identifier", e.resourceIdentifier),
			// Add database connection string for correlation (sanitized)
			attribute.String("db.connection_string", "localhost/postgres"),
			attribute.String("db.system", "postgres"),
		)
	}
}

// OnEnd is called when a span ends - here we can read the SQL statement and set the operation
func (e *SQLOperationEnhancer) OnEnd(s trace.ReadOnlySpan) {
	spanName := s.Name()

	if e.isSQLSpan(spanName) {
		// Extract SQL operation from the span attributes
		var sqlStatement string
		for _, attr := range s.Attributes() {
			if attr.Key == "db.statement" {
				sqlStatement = attr.Value.AsString()
				break
			}
		}

		if sqlStatement != "" {
			operation := e.extractSQLOperation(sqlStatement)
			fmt.Printf("SQL span '%s' with operation '%s' completed\n", spanName, operation)

			// Note: We can't modify the span here since it's ReadOnlySpan
			// The operation should be set by the otelsql library automatically
			// If it's not working, we need to investigate the otelsql configuration
		}
	}
}

// Shutdown is called when the processor is shut down
func (e *SQLOperationEnhancer) Shutdown(ctx context.Context) error {
	return nil
}

// ForceFlush is called to force flush any buffered spans
func (e *SQLOperationEnhancer) ForceFlush(ctx context.Context) error {
	return nil
}

// isSQLSpan checks if the span is a SQL span that needs enhancement
func (e *SQLOperationEnhancer) isSQLSpan(spanName string) bool {
	sqlSpanNames := []string{
		"sql.conn.exec",
		"sql.conn.query",
		"sql.conn.query_row",
		"sql.conn.prepare",
		"sql.conn.reset_session",
		"postgres", // Also target the postgres span name
	}

	for _, sqlSpan := range sqlSpanNames {
		if spanName == sqlSpan {
			return true
		}
	}

	return false
}

// extractSQLOperation extracts the SQL operation type from a SQL statement
func (e *SQLOperationEnhancer) extractSQLOperation(sqlStatement string) string {
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
