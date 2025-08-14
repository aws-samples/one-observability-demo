package payforadoption

import (
	"context"
	"testing"
	"time"

	"github.com/go-kit/log"
	"go.opentelemetry.io/otel/trace/noop"
)

func BenchmarkCompleteAdoptionNormal(b *testing.B) {
	logger := log.NewNopLogger()
	repo := &mockRepository{}
	tracer := noop.NewTracerProvider().Tracer("benchmark")
	service := NewService(logger, repo, tracer)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := service.CompleteAdoption(ctx, "pet123", "dog", "user456")
		if err != nil {
			b.Fatalf("Unexpected error: %v", err)
		}
	}
}

func BenchmarkCompleteAdoptionWithErrorMode(b *testing.B) {
	logger := log.NewNopLogger()
	repo := &mockRepository{
		errorModeEnabled: true,
	}
	tracer := noop.NewTracerProvider().Tracer("benchmark")
	service := NewService(logger, repo, tracer)

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Error mode will sometimes fail, sometimes succeed
		service.CompleteAdoption(ctx, "pet123", "dog", "user456")
	}
}

func BenchmarkDegradationScenarios(b *testing.B) {
	logger := log.NewNopLogger()
	startTime := time.Now()
	adoption := Adoption{
		TransactionID: "bench-123",
		PetID:         "pet123",
		PetType:       "dog",
		UserID:        "user456",
		AdoptionDate:  time.Now(),
	}
	ctx := context.Background()

	b.Run("DefaultDegradation", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			defaultDegradation(ctx, logger, adoption, startTime)
		}
	})

	b.Run("CircuitBreakerDegradation", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			circuitBreakerDegradation(ctx, logger, adoption, startTime)
		}
	})

	b.Run("SystemStressDegradation", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			systemStressDegradation(ctx, logger, adoption, startTime)
		}
	})
}

func BenchmarkDatabaseConfigService(b *testing.B) {
	cfg := Config{
		RDSSecretArn: "arn:aws:secretsmanager:us-west-2:123456789012:secret:test-secret",
		AWSRegion:    "us-west-2",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		dbSvc := NewDatabaseConfigService(cfg)
		_ = dbSvc
	}
}
