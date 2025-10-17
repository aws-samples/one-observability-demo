/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"context"
	"database/sql"
	"fmt"

	"petadoptions/payforadoption"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// AuroraCorrelationWrapper wraps database operations to add Aurora correlation attributes
type AuroraCorrelationWrapper struct {
	db                 *sql.DB
	resourceIdentifier string
	dbUser             string
	host               string
}

// NewAuroraCorrelationWrapper creates a new wrapper for Aurora correlation
func NewAuroraCorrelationWrapper(db *sql.DB, resourceIdentifier, dbUser, host string) *AuroraCorrelationWrapper {
	return &AuroraCorrelationWrapper{
		db:                 db,
		resourceIdentifier: resourceIdentifier,
		dbUser:             dbUser,
		host:               host,
	}
}

// ExecContext wraps sql.DB.ExecContext - Aurora correlation handled by span processor
func (w *AuroraCorrelationWrapper) ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	// Aurora correlation attributes are now added by the SQLSpanProcessor
	// This ensures they're added to the correct sql.conn.exec span
	return w.db.ExecContext(ctx, query, args...)
}

// QueryContext wraps sql.DB.QueryContext - Aurora correlation handled by span processor
func (w *AuroraCorrelationWrapper) QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	// Aurora correlation attributes are now added by the SQLSpanProcessor
	// This ensures they're added to the correct sql.conn.query span
	return w.db.QueryContext(ctx, query, args...)
}

// QueryRowContext wraps sql.DB.QueryRowContext - Aurora correlation handled by span processor
func (w *AuroraCorrelationWrapper) QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row {
	// Aurora correlation attributes are now added by the SQLSpanProcessor
	// This ensures they're added to the correct sql.conn.query_row span
	return w.db.QueryRowContext(ctx, query, args...)
}

// Close wraps sql.DB.Close
func (w *AuroraCorrelationWrapper) Close() error {
	return w.db.Close()
}

// Ping wraps sql.DB.Ping
func (w *AuroraCorrelationWrapper) Ping() error {
	return w.db.Ping()
}

// PingContext wraps sql.DB.PingContext
func (w *AuroraCorrelationWrapper) PingContext(ctx context.Context) error {
	return w.db.PingContext(ctx)
}

// Enhanced repository that uses the Aurora correlation wrapper
type EnhancedRepository struct {
	payforadoption.Repository
	db *AuroraCorrelationWrapper
}

// NewEnhancedRepository creates a repository with Aurora correlation support
func NewEnhancedRepository(originalRepo payforadoption.Repository, db *AuroraCorrelationWrapper) *EnhancedRepository {
	return &EnhancedRepository{
		Repository: originalRepo,
		db:         db,
	}
}

// CreateTransaction overrides the original method to use the enhanced database wrapper
func (r *EnhancedRepository) CreateTransaction(ctx context.Context, a payforadoption.Adoption) error {
	span := trace.SpanFromContext(ctx)
	span.AddEvent("creating transaction in Aurora PG DB")

	sql := `INSERT INTO transactions (pet_id, adoption_date, transaction_id, user_id) VALUES ($1, $2, $3, $4)`

	_, err := r.db.ExecContext(ctx, sql, a.PetID, a.AdoptionDate, a.TransactionID, a.UserID)
	if err != nil {
		span.RecordError(err)
		return fmt.Errorf("failed to create transaction: %w", err)
	}

	return nil
}

// DropTransactions overrides the original method to use the enhanced database wrapper
func (r *EnhancedRepository) DropTransactions(ctx context.Context, userID string) error {
	span := trace.SpanFromContext(ctx)
	span.AddEvent("removing user transactions in Aurora PG DB")

	sql := `DELETE FROM transactions WHERE user_id = $1`

	result, err := r.db.ExecContext(ctx, sql, userID)
	if err != nil {
		span.RecordError(err)
		return fmt.Errorf("failed to delete user transactions: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	span.SetAttributes(attribute.Int64("db.rows_affected", rowsAffected))

	return nil
}
