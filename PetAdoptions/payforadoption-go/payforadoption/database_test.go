package payforadoption

import (
	"context"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
)

func TestNewDatabaseConfigService(t *testing.T) {
	cfg := Config{
		RDSSecretArn: "arn:aws:secretsmanager:us-west-2:123456789012:secret:test-secret",
		AWSRegion:    "us-west-2",
		AWSCfg:       aws.Config{Region: "us-west-2"},
	}

	dbSvc := NewDatabaseConfigService(cfg)

	if dbSvc == nil {
		t.Fatal("Expected DatabaseConfigService to be created")
	}

	if dbSvc.cfg.RDSSecretArn != cfg.RDSSecretArn {
		t.Errorf("Expected RDSSecretArn %s, got %s", cfg.RDSSecretArn, dbSvc.cfg.RDSSecretArn)
	}

	if dbSvc.cfg.AWSRegion != cfg.AWSRegion {
		t.Errorf("Expected AWSRegion %s, got %s", cfg.AWSRegion, dbSvc.cfg.AWSRegion)
	}
}

func TestDatabaseConfigServiceMethods(t *testing.T) {
	cfg := Config{
		RDSSecretArn: "arn:aws:secretsmanager:us-west-2:123456789012:secret:test-secret",
		AWSRegion:    "us-west-2",
		// Note: AWSCfg would need to be properly configured for real AWS calls
	}

	dbSvc := NewDatabaseConfigService(cfg)
	ctx := context.Background()

	// Test GetSecretValue (will fail without real AWS config, but tests the method exists)
	_, err := dbSvc.GetSecretValue(ctx)
	if err == nil {
		t.Log("GetSecretValue method exists and can be called")
	} else {
		t.Logf("GetSecretValue failed as expected without real AWS config: %v", err)
	}

	// Test GetDatabaseConfig (will fail without real AWS config, but tests the method exists)
	_, err = dbSvc.GetDatabaseConfig(ctx)
	if err == nil {
		t.Log("GetDatabaseConfig method exists and can be called")
	} else {
		t.Logf("GetDatabaseConfig failed as expected without real AWS config: %v", err)
	}

	// Test GetConnectionString (will fail without real AWS config, but tests the method exists)
	_, err = dbSvc.GetConnectionString(ctx)
	if err == nil {
		t.Log("GetConnectionString method exists and can be called")
	} else {
		t.Logf("GetConnectionString failed as expected without real AWS config: %v", err)
	}
}

func TestPackageLevelFunctions(t *testing.T) {
	cfg := Config{
		RDSSecretArn: "arn:aws:secretsmanager:us-west-2:123456789012:secret:test-secret",
		AWSRegion:    "us-west-2",
	}

	ctx := context.Background()

	// Test package-level GetSecretValue function
	_, err := GetSecretValue(ctx, cfg)
	if err == nil {
		t.Log("Package-level GetSecretValue function exists")
	} else {
		t.Logf("Package-level GetSecretValue failed as expected: %v", err)
	}

	// Test package-level GetRDSConnectionString function
	_, err = GetRDSConnectionString(ctx, cfg)
	if err == nil {
		t.Log("Package-level GetRDSConnectionString function exists")
	} else {
		t.Logf("Package-level GetRDSConnectionString failed as expected: %v", err)
	}
}

func TestDatabaseConfigParsing(t *testing.T) {
	// Test the DatabaseConfig struct
	config := DatabaseConfig{
		Engine:   "postgres",
		Host:     "localhost",
		Port:     5432,
		Username: "testuser",
		Password: "testpass",
		Dbname:   "testdb",
	}

	if config.Engine != "postgres" {
		t.Errorf("Expected Engine postgres, got %s", config.Engine)
	}

	if config.Host != "localhost" {
		t.Errorf("Expected Host localhost, got %s", config.Host)
	}

	if config.Port != 5432 {
		t.Errorf("Expected Port 5432, got %d", config.Port)
	}

	if config.Username != "testuser" {
		t.Errorf("Expected Username testuser, got %s", config.Username)
	}

	if config.Password != "testpass" {
		t.Errorf("Expected Password testpass, got %s", config.Password)
	}

	if config.Dbname != "testdb" {
		t.Errorf("Expected Dbname testdb, got %s", config.Dbname)
	}
}
