/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package payforadoption

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// DatabaseConfig represents the database configuration from AWS Secrets Manager
type DatabaseConfig struct {
	Engine, Host, Username, Password, Dbname string
	Port                                     int
}

// DatabaseConfigService handles database configuration operations
type DatabaseConfigService struct {
	cfg Config
}

// NewDatabaseConfigService creates a new database configuration service
func NewDatabaseConfigService(cfg Config) *DatabaseConfigService {
	return &DatabaseConfigService{cfg: cfg}
}

// GetSecretValue retrieves the RDS secret from AWS Secrets Manager
func (dcs *DatabaseConfigService) GetSecretValue(ctx context.Context) (string, error) {
	svc := secretsmanager.NewFromConfig(dcs.cfg.AWSCfg)
	res, err := svc.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: aws.String(dcs.cfg.RDSSecretArn),
	})

	if err != nil {
		return "", err
	}

	return aws.ToString(res.SecretString), nil
}

// GetDatabaseConfig retrieves and parses the database configuration
func (dcs *DatabaseConfigService) GetDatabaseConfig(ctx context.Context) (*DatabaseConfig, error) {
	jsonstr, err := dcs.GetSecretValue(ctx)
	if err != nil {
		return nil, err
	}

	var config DatabaseConfig
	if err := json.Unmarshal([]byte(jsonstr), &config); err != nil {
		return nil, err
	}

	return &config, nil
}

// GetConnectionString builds the PostgreSQL connection string from AWS Secrets Manager
func (dcs *DatabaseConfigService) GetConnectionString(ctx context.Context) (string, error) {
	config, err := dcs.GetDatabaseConfig(ctx)
	if err != nil {
		return "", err
	}

	u := &url.URL{
		Scheme: config.Engine,
		User:   url.UserPassword(config.Username, config.Password),
		Host:   fmt.Sprintf("%s:%d", config.Host, config.Port),
		Path:   config.Dbname,
	}

	connStr := u.String()
	connStr += "?sslmode=disable"

	return connStr, nil
}

// Package-level convenience functions for backward compatibility

// GetSecretValue is a package-level function for retrieving secrets
func GetSecretValue(ctx context.Context, cfg Config) (string, error) {
	dcs := NewDatabaseConfigService(cfg)
	return dcs.GetSecretValue(ctx)
}

// GetRDSConnectionString is a package-level function for getting connection strings
func GetRDSConnectionString(ctx context.Context, cfg Config) (string, error) {
	dcs := NewDatabaseConfigService(cfg)
	return dcs.GetConnectionString(ctx)
}
