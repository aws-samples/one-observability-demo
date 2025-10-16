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
	"strings"

	"petadoptions/payforadoption"

	"github.com/XSAM/otelsql"
	"github.com/go-kit/log"
	_ "github.com/lib/pq"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Enhanced database connection with proper Aurora correlation attributes
func createInstrumentedDB(ctx context.Context, cfg payforadoption.Config) (*sql.DB, error) {
	// Get database configuration from secrets manager
	dbService := payforadoption.NewDatabaseConfigService(cfg)
	dbConfig, err := dbService.GetDatabaseConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database config: %w", err)
	}

	// Build connection string
	connStr := buildEnhancedConnectionString(dbConfig)

	// Build resource identifier for Aurora correlation
	// Format: engine|host|port for CloudWatch Application Signals correlation
	resourceIdentifier := fmt.Sprintf("postgres|%s|%d", dbConfig.Host, dbConfig.Port)

	// Use the original simple approach to preserve service detection
	// Only add the basic database system attribute
	db, err := otelsql.Open("postgres", connStr, otelsql.WithAttributes(
		semconv.DBSystemKey.String("postgres"),
	))
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
		fmt.Printf("Warning: failed to register DB stats metrics: %v\n", err)
	}

	return db, nil
}

// isAuroraCluster checks if the hostname indicates an Aurora cluster
func isAuroraCluster(host string) bool {
	return strings.Contains(host, ".cluster-") && strings.Contains(host, ".rds.amazonaws.com")
}

// extractClusterIdentifier extracts the cluster identifier from Aurora hostname
func extractClusterIdentifier(host string) string {
	if !isAuroraCluster(host) {
		return ""
	}

	// Extract cluster identifier from hostname like: cluster-name.cluster-xyz.region.rds.amazonaws.com
	parts := strings.Split(host, ".")
	if len(parts) >= 2 && strings.Contains(parts[1], "cluster-") {
		return parts[0] // Return the cluster name part
	}
	return ""
}

// Enhanced connection string builder with better attribute support
func buildEnhancedConnectionString(config *payforadoption.DatabaseConfig) string {
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

// createEnhancedRepository creates a repository with Aurora correlation support
func createEnhancedRepository(ctx context.Context, db *sql.DB, cfg payforadoption.Config, logger log.Logger) (payforadoption.Repository, error) {
	// Get database configuration for correlation attributes
	dbService := payforadoption.NewDatabaseConfigService(cfg)
	dbConfig, err := dbService.GetDatabaseConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get database config for correlation: %w", err)
	}

	// Build resource identifier for Aurora correlation
	resourceIdentifier := fmt.Sprintf("postgres|%s|%d", dbConfig.Host, dbConfig.Port)

	// Create Aurora correlation wrapper
	auroraWrapper := NewAuroraCorrelationWrapper(db, resourceIdentifier, dbConfig.Username, dbConfig.Host)

	// Create original repository
	originalRepo := payforadoption.NewRepository(db, cfg, logger)

	// Return enhanced repository with Aurora correlation
	return NewEnhancedRepository(originalRepo, auroraWrapper), nil
}
