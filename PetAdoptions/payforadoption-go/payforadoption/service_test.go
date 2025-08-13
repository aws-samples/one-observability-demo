package payforadoption

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/go-kit/log"
	"go.opentelemetry.io/otel/trace/noop"
)

// Mock repository for testing
type mockRepository struct {
	errorModeEnabled      bool
	createTransactionErr  error
	updateAvailabilityErr error
	sendHistoryMessageErr error
	connectionString      string
}

func (m *mockRepository) CreateTransaction(ctx context.Context, a Adoption) error {
	return m.createTransactionErr
}

func (m *mockRepository) SendHistoryMessage(ctx context.Context, a Adoption) error {
	return m.sendHistoryMessageErr
}

func (m *mockRepository) DropTransactions(ctx context.Context) error {
	return nil
}

func (m *mockRepository) UpdateAvailability(ctx context.Context, a Adoption) error {
	return m.updateAvailabilityErr
}

func (m *mockRepository) TriggerSeeding(ctx context.Context) error {
	return nil
}

func (m *mockRepository) CreateSQLTables(ctx context.Context) error {
	return nil
}

func (m *mockRepository) GetConnectionString(ctx context.Context) (string, error) {
	if m.connectionString != "" {
		return m.connectionString, nil
	}
	return "postgres://user:pass@localhost:5432/testdb?sslmode=disable", nil
}

func (m *mockRepository) ErrorModeOn(ctx context.Context) bool {
	return m.errorModeEnabled
}

func TestCompleteAdoptionSuccess(t *testing.T) {
	logger := log.NewNopLogger()
	repo := &mockRepository{}
	tracer := noop.NewTracerProvider().Tracer("test")

	service := NewService(logger, repo, tracer)

	ctx := context.Background()
	petID := "pet123"
	petType := "dog"
	userID := "user456"

	adoption, err := service.CompleteAdoption(ctx, petID, petType, userID)

	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if adoption.PetID != petID {
		t.Errorf("Expected PetID %s, got %s", petID, adoption.PetID)
	}

	if adoption.PetType != petType {
		t.Errorf("Expected PetType %s, got %s", petType, adoption.PetType)
	}

	if adoption.UserID != userID {
		t.Errorf("Expected UserID %s, got %s", userID, adoption.UserID)
	}

	if adoption.TransactionID == "" {
		t.Error("Expected TransactionID to be generated")
	}

	if adoption.AdoptionDate.IsZero() {
		t.Error("Expected AdoptionDate to be set")
	}

	// Verify the adoption date is recent (within last minute)
	if time.Since(adoption.AdoptionDate) > time.Minute {
		t.Error("Expected AdoptionDate to be recent")
	}
}

func TestCompleteAdoptionCreateTransactionFailure(t *testing.T) {
	logger := log.NewNopLogger()
	repo := &mockRepository{
		createTransactionErr: errors.New("database connection failed"),
	}
	tracer := noop.NewTracerProvider().Tracer("test")

	service := NewService(logger, repo, tracer)

	ctx := context.Background()
	_, err := service.CompleteAdoption(ctx, "pet123", "dog", "user456")

	if err == nil {
		t.Fatal("Expected error when CreateTransaction fails")
	}

	if err.Error() != "database connection failed" {
		t.Errorf("Expected specific error message, got %v", err)
	}
}

func TestCompleteAdoptionUpdateAvailabilityFailure(t *testing.T) {
	logger := log.NewNopLogger()
	repo := &mockRepository{
		updateAvailabilityErr: errors.New("pet status service unavailable"),
	}
	tracer := noop.NewTracerProvider().Tracer("test")

	service := NewService(logger, repo, tracer)

	ctx := context.Background()
	_, err := service.CompleteAdoption(ctx, "pet123", "dog", "user456")

	if err == nil {
		t.Fatal("Expected error when UpdateAvailability fails")
	}

	if err.Error() != "pet status service unavailable" {
		t.Errorf("Expected specific error message, got %v", err)
	}
}

func TestCompleteAdoptionHistoryMessageFailure(t *testing.T) {
	logger := log.NewNopLogger()
	repo := &mockRepository{
		sendHistoryMessageErr: errors.New("SQS unavailable"),
	}
	tracer := noop.NewTracerProvider().Tracer("test")

	service := NewService(logger, repo, tracer)

	ctx := context.Background()
	adoption, err := service.CompleteAdoption(ctx, "pet123", "dog", "user456")

	// Should succeed even if history message fails
	if err != nil {
		t.Fatalf("Expected no error when history message fails, got %v", err)
	}

	if adoption.PetID != "pet123" {
		t.Errorf("Expected adoption to be processed despite history failure")
	}
}

func TestCompleteAdoptionWithErrorMode(t *testing.T) {
	logger := log.NewNopLogger()
	repo := &mockRepository{
		errorModeEnabled: true,
	}
	tracer := noop.NewTracerProvider().Tracer("test")

	service := NewService(logger, repo, tracer)

	ctx := context.Background()

	// Test multiple times to potentially hit different degradation scenarios
	for i := 0; i < 5; i++ {
		_, err := service.CompleteAdoption(ctx, "pet123", "dog", "user456")

		// Error mode should sometimes cause failures
		// We don't assert specific errors since they're randomized
		if err != nil {
			t.Logf("Error mode triggered failure (expected): %v", err)
		} else {
			t.Logf("Error mode allowed success (possible)")
		}
	}
}
func TestDatabaseConfigService(t *testing.T) {
	// Test the database configuration service
	cfg := Config{
		RDSSecretArn: "test-secret-arn",
		// AWSCfg would normally be set, but we're testing the structure
	}

	dbSvc := NewDatabaseConfigService(cfg)
	if dbSvc == nil {
		t.Fatal("Expected DatabaseConfigService to be created")
	}

	// Test that the service holds the correct config
	if dbSvc.cfg.RDSSecretArn != "test-secret-arn" {
		t.Errorf("Expected RDSSecretArn to be set correctly")
	}
}

func TestDatabaseConnectionExhaustion(t *testing.T) {
	logger := log.NewNopLogger()

	// Test the connection exhauster directly
	exhauster := NewDatabaseConnectionExhauster(logger)

	// Test with a mock connection string (this won't actually connect)
	mockConnStr := "postgres://user:pass@nonexistent:5432/testdb?sslmode=disable"

	// This should fail gracefully since the host doesn't exist
	err := exhauster.ExhaustConnections(context.Background(), mockConnStr, 2)

	// We expect this to fail since the connection string points to a non-existent host
	if err == nil {
		t.Error("Expected connection exhaustion to fail with non-existent host")
	}

	// Verify connection count (should be 0 since connections failed)
	count := exhauster.GetConnectionCount()
	if count != 0 {
		t.Errorf("Expected 0 connections after failure, got %d", count)
	}

	// Test cleanup (should not panic even with no connections)
	exhauster.ReleaseConnections()
}

func TestDegradationScenarios(t *testing.T) {
	logger := log.NewNopLogger()
	startTime := time.Now()
	adoption := Adoption{
		TransactionID: "test-123",
		PetID:         "pet123",
		PetType:       "dog",
		UserID:        "user456",
		AdoptionDate:  time.Now(),
	}

	ctx := context.Background()

	t.Run("DefaultDegradation", func(t *testing.T) {
		result := defaultDegradation(ctx, logger, adoption, startTime)

		if result.Error != nil {
			t.Errorf("Default degradation should not return error, got %v", result.Error)
		}

		if result.Duration == 0 {
			t.Error("Expected duration to be recorded")
		}

		if result.Adoption.TransactionID != adoption.TransactionID {
			t.Error("Expected adoption to be preserved")
		}
	})

	t.Run("CircuitBreakerDegradation", func(t *testing.T) {
		result := circuitBreakerDegradation(ctx, logger, adoption, startTime)

		if result.Error == nil {
			t.Error("Circuit breaker degradation should return error")
		}

		if result.Duration == 0 {
			t.Error("Expected duration to be recorded")
		}
	})

	t.Run("SystemStressDegradation", func(t *testing.T) {
		result := systemStressDegradation(ctx, logger, adoption, startTime)

		if result.Error == nil {
			t.Error("System stress degradation should return error")
		}

		if result.Duration == 0 {
			t.Error("Expected duration to be recorded")
		}
	})

	t.Run("DatabaseConnectionDegradation", func(t *testing.T) {
		repo := &mockRepository{
			connectionString: "postgres://user:pass@nonexistent:5432/testdb?sslmode=disable",
		}

		result := databaseConnectionDegradation(ctx, logger, adoption, startTime, repo)

		if result.Error == nil {
			t.Error("Database connection degradation should return error")
		}

		if result.Duration == 0 {
			t.Error("Expected duration to be recorded")
		}
	})
}

func TestHealthCheck(t *testing.T) {
	logger := log.NewNopLogger()
	repo := &mockRepository{}
	tracer := noop.NewTracerProvider().Tracer("test")

	service := NewService(logger, repo, tracer)

	err := service.HealthCheck(context.Background())
	if err != nil {
		t.Errorf("HealthCheck should always return nil, got %v", err)
	}
}

func TestCleanupAdoptions(t *testing.T) {
	logger := log.NewNopLogger()
	repo := &mockRepository{}
	tracer := noop.NewTracerProvider().Tracer("test")

	service := NewService(logger, repo, tracer)

	err := service.CleanupAdoptions(context.Background())
	if err != nil {
		t.Errorf("CleanupAdoptions should succeed with mock repo, got %v", err)
	}
}

func TestTriggerSeeding(t *testing.T) {
	logger := log.NewNopLogger()
	repo := &mockRepository{}
	tracer := noop.NewTracerProvider().Tracer("test")

	service := NewService(logger, repo, tracer)

	err := service.TriggerSeeding(context.Background())
	if err != nil {
		t.Errorf("TriggerSeeding should succeed with mock repo, got %v", err)
	}
}
