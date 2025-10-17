/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"

	"petadoptions/payforadoption"

	"github.com/XSAM/otelsql"
	"github.com/go-kit/log"
	_ "github.com/lib/pq"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// createInstrumentedDB creates an instrumented database connection
// Aurora correlation is handled by the SQL span processor
func createInstrumentedDB(ctx context.Context, cfg payforadoption.Config) (*sql.DB, error) {
	// Get database configuration from secrets manager
	dbService := payforadoption.NewDatabaseConfigService(cfg)
	dbConfig, err := dbService.GetDatabaseConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database config: %w", err)
	}

	// Build connection string
	connStr := buildConnectionString(dbConfig)

	// Build resource identifier for Aurora correlation
	// Format: engine|host|port for CloudWatch Application Signals correlation
	resourceIdentifier := fmt.Sprintf("postgres|%s|%d", dbConfig.Host, dbConfig.Port)

	// Create instrumented database with enhanced options to preserve SQL operation information
	db, err := otelsql.Open("postgres", connStr,
		// Basic database system attribute for service detection
		otelsql.WithAttributes(
			semconv.DBSystemKey.String("postgres"),
		),
		// Enable SQL commenter to preserve query information
		otelsql.WithSQLCommenter(true),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to open instrumented database: %w", err)
	}

	// Register database stats for monitoring
	if err := otelsql.RegisterDBStatsMetrics(db, otelsql.WithAttributes(
		semconv.DBSystemKey.String("postgres"),
		semconv.DBNamespaceKey.String(dbConfig.Dbname),
		attribute.String("db.instance.id", resourceIdentifier),
	)); err != nil {
		// Log warning but don't fail - metrics registration is optional
		WarnWithTrace(ctx, "Warning: failed to register DB stats metrics: %v\n", err)
	}

	return db, nil
}

// buildConnectionString builds a PostgreSQL connection string
func buildConnectionString(config *payforadoption.DatabaseConfig) string {
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(config.Username, config.Password),
		Host:   fmt.Sprintf("%s:%d", config.Host, config.Port),
		Path:   config.Dbname,
	}

	// Add SSL mode and other PostgreSQL-specific parameters
	params := url.Values{}
	params.Add("sslmode", "require") // Use SSL for Aurora connections
	params.Add("application_name", "payforadoption-go")

	u.RawQuery = params.Encode()
	return u.String()
}

// createRepository creates a standard repository
// Aurora correlation is now handled by the SQL span processor
func createRepository(ctx context.Context, db *sql.DB, cfg payforadoption.Config, logger log.Logger) (payforadoption.Repository, error) {
	// Create standard repository - Aurora correlation handled by SQL span processor
	return payforadoption.NewRepository(db, cfg, logger), nil
}
