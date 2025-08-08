package payforadoption

import (
	"context"
	"testing"
	"time"

	"github.com/go-kit/log"
	"go.opentelemetry.io/otel/trace/noop"
)

// Mock repository for testing
type mockRepository struct{}

func (m *mockRepository) CreateTransaction(ctx context.Context, a Adoption) error {
	return nil
}

func (m *mockRepository) DropTransactions(ctx context.Context) error {
	return nil
}

func (m *mockRepository) UpdateAvailability(ctx context.Context, a Adoption) error {
	return nil
}

func (m *mockRepository) TriggerSeeding(ctx context.Context) error {
	return nil
}

func (m *mockRepository) CreateSQLTables(ctx context.Context) error {
	return nil
}

func (m *mockRepository) ErrorModeOn(ctx context.Context) bool {
	return false
}

func TestCompleteAdoptionWithUserID(t *testing.T) {
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
