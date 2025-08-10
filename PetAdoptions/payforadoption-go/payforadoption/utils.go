package payforadoption

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/XSAM/otelsql"
	"github.com/go-kit/log"
	"github.com/go-kit/log/level"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

type CustomerInfo struct {
	ID         int64
	FullName   string
	Address    string
	CreditCard string
	Email      string
}

func getFakeCustomer() CustomerInfo {
	now := time.Now().UnixNano()
	r := rand.New(rand.NewSource(now))
	fullname := fmt.Sprintf("%s %s", getFirstName(r), getLastName(r))

	return CustomerInfo{
		ID:         time.Now().UnixNano(),
		FullName:   fullname,
		Email:      strings.ToLower(fmt.Sprintf("%s.com", strings.ReplaceAll(fullname, " ", "@"))),
		CreditCard: getFakeCreditCard(r),
		Address:    getAddresses(r),
	}
}

func getFakeCreditCard(r *rand.Rand) string {

	//not real cards
	//from https://developer.paypal.com/braintree/docs/guides/credit-cards/testing-go-live/node
	seed := []string{
		"4217651111111119",
		"4500600000000061",
		"4005519200000004",
		"4012000077777777",
		"4012000033330026",
		"2223000048400011",
		"6304000000000000",
	}

	return seed[r.Intn(len(seed))]
}

func getFirstName(r *rand.Rand) string {
	seed := []string{
		"Catherine",
		"Javier",
		"Alex",
		"Frank",
		"Mark",
		"Fatiha",
		"Purva",
		"Selim",
		"Jane",
		"Alan",
		"Mohamed",
	}
	return seed[r.Intn(len(seed))]
}

func getLastName(r *rand.Rand) string {
	seed := []string{
		"Banks",
		"Marley",
		"Konan",
		"Lopez",
		"Gonzales",
		"Levine",
		"Fofana",
		"Hernan",
		"Zheng",
		"Chergui",
		"Mousli",
	}
	return seed[r.Intn(len(seed))]
}

func getAddresses(r *rand.Rand) string {

	// Random addresses
	seed := []string{
		"8 Rue de la Pompe, 75116 Paris",
		"174 Quai de Jemmapes, 75010 Paris, France",
		"60 Holborn Viaduct, London, EC1A 2FD",
		"3333 Piedmont Road NE, Atlanta, GA 30305",
		"2121 7th Ave, Seattle WA, 98121",
		"2021 7th Ave, Seattle WA, 98121",
		"31 place des Corolles, 92400 Courbevoie",
		"120 Avenue de Versailles, 75016 Paris",
	}
	return seed[r.Intn(len(seed))]
}

// ========================================
// Error Mode Degradation Scenarios
// ========================================

// DegradationResult contains the result of a degradation scenario
type DegradationResult struct {
	Adoption Adoption
	Error    error
	Duration time.Duration
}

// simulateHighCPU creates CPU pressure to simulate performance degradation
func simulateHighCPU(duration time.Duration) {
	end := time.Now().Add(duration)
	for time.Now().Before(end) {
		// Busy loop to consume CPU cycles
		for i := 0; i < 1000000; i++ {
			_ = i * i
		}
		// Small sleep to prevent complete CPU starvation
		time.Sleep(time.Microsecond)
	}
}

// simulateNetworkLatency adds artificial network-like delays with jitter
func simulateNetworkLatency(baseMs, jitterMs int) {
	delay := time.Duration(baseMs+rand.Intn(jitterMs)) * time.Millisecond
	time.Sleep(delay)
}

// memoryLeak creates memory pressure (original function moved here for organization)
func memoryLeak() {

	type T struct {
		v [2 << 20]int
		t *T
	}

	var finalizer = func(t *T) {}

	var x, y T

	// The SetFinalizer call makes x escape to heap.
	runtime.SetFinalizer(&x, finalizer)

	// The following line forms a cyclic reference
	// group with two members, x and y.
	// This causes x and y are not collectable.
	x.t, y.t = &y, &x // y also escapes to heap.
}

// Critical system stress scenario
func systemStressDegradation(ctx context.Context, logger log.Logger, adoption Adoption, startTime time.Time) DegradationResult {
	degradationType := "system stress"
	level.Error(logger).Log("degradation", degradationType, "severity", "critical")

	// Add CPU pressure for realistic system stress
	go simulateHighCPU(500 * time.Millisecond)
	go memoryLeak()

	duration := time.Since(startTime)

	return DegradationResult{
		Adoption: adoption,
		Error:    errors.New("memory allocation failure"),
		Duration: duration,
	}
}

// Circuit breaker pattern scenario
func circuitBreakerDegradation(ctx context.Context, logger log.Logger, adoption Adoption, startTime time.Time) DegradationResult {
	// if rand.Intn(10) < 3 { // 30% failure rate
	degradationType := "circuit breaker open"
	level.Error(logger).Log("degradation", degradationType, "severity", "high")

	simulateNetworkLatency(500, 200) // Quick failure
	duration := time.Since(startTime)

	return DegradationResult{
		Adoption: Adoption{},
		Error:    errors.New("payment service unavailable"),
		Duration: duration,
	}

}

// Real database connection exhaustion scenario
func databaseConnectionDegradation(ctx context.Context, logger log.Logger, adoption Adoption, startTime time.Time, repository Repository) DegradationResult {
	degradationType := "database connection exhaustion"
	level.Error(logger).Log("degradation", degradationType, "severity", "critical")

	// Get the connection string from the repository
	connStr, err := repository.GetConnectionString(ctx)
	if err != nil {
		level.Error(logger).Log("failed_to_get_connection_string", err)
		// Fallback to simulated timeout
		simulateNetworkLatency(5000, 1000)
		duration := time.Since(startTime)
		return DegradationResult{
			Adoption: Adoption{},
			Error:    fmt.Errorf("failed to retrieve database connection configuration: %v", err),
			Duration: duration,
		}
	}

	level.Info(logger).Log("connection_string_retrieved", "success", "degradation_mode", "database_exhaustion")

	// Get the connection exhauster
	exhauster := GetConnectionExhauster(logger)

	maxConnections := 100 // Conservative number to avoid completely killing the database
	level.Warn(logger).Log("attempting_connection_exhaustion", maxConnections, "connection_string_length", len(connStr))

	// Attempt to exhaust connections
	exhaustErr := exhauster.ExhaustConnections(ctx, connStr, maxConnections)

	duration := time.Since(startTime)

	if exhaustErr != nil {
		level.Error(logger).Log("connection_exhaustion_failed", exhaustErr, "connections_held", exhauster.GetConnectionCount())

		// Even if we couldn't exhaust all connections, we might have opened some
		// Release them after a delay to simulate the issue
		go func() {
			time.Sleep(30 * time.Second) // Hold connections for 30 seconds
			level.Info(logger).Log("releasing_partial_connections", "cleanup")
			exhauster.ReleaseConnections()
		}()

		return DegradationResult{
			Adoption: Adoption{},
			Error:    fmt.Errorf("database connection pool exhausted - %v", exhaustErr),
			Duration: duration,
		}
	}

	level.Error(logger).Log("database_connections_exhausted", exhauster.GetConnectionCount(), "duration_ms", duration.Milliseconds())

	// Release connections after a delay to simulate the real issue
	go func() {
		time.Sleep(45 * time.Second) // Hold connections for 45 seconds to show real impact
		level.Info(logger).Log("releasing_exhausted_connections", "auto_cleanup", "connections", exhauster.GetConnectionCount())
		exhauster.ReleaseConnections()
	}()

	return DegradationResult{
		Adoption: Adoption{},
		Error:    errors.New("database connection pool exhausted - no available connections"),
		Duration: duration,
	}
}

// just slow requests
func defaultDegradation(ctx context.Context, logger log.Logger, adoption Adoption, startTime time.Time) DegradationResult {
	degradationType := "default"
	level.Error(logger).Log("degradation", degradationType, "severity", "low")

	// Simulate cascading delays
	simulateNetworkLatency(1000, 800)

	duration := time.Since(startTime)

	return DegradationResult{
		Adoption: adoption,
		Error:    nil,
		Duration: duration,
	}
}

// handleDefaultDegradation - Cascading slowness scenario
func handleDefaultDegradation(ctx context.Context, logger log.Logger, adoption Adoption, startTime time.Time, repository Repository) DegradationResult {

	// randomly choose between scenarios: defaultDegradation, circuitBreakerDegradation, systemStressDegradation, databaseConnectionDegradation
	switch rand.Intn(10) {
	case 0, 1:
		return circuitBreakerDegradation(ctx, logger, adoption, startTime)
	case 2, 3:
		return systemStressDegradation(ctx, logger, adoption, startTime)
	case 4, 5, 6:
		return databaseConnectionDegradation(ctx, logger, adoption, startTime, repository)
	default:
		return defaultDegradation(ctx, logger, adoption, startTime)
	}

}

// ========================================
// Real Database Connection Exhaustion
// ========================================

// DatabaseConnectionExhauster manages real database connection exhaustion
type DatabaseConnectionExhauster struct {
	connections []*sql.DB
	mutex       sync.Mutex
	logger      log.Logger
}

// NewDatabaseConnectionExhauster creates a new connection exhauster
func NewDatabaseConnectionExhauster(logger log.Logger) *DatabaseConnectionExhauster {
	return &DatabaseConnectionExhauster{
		connections: make([]*sql.DB, 0),
		logger:      logger,
	}
}

// ExhaustConnections opens many database connections to simulate connection pool exhaustion
func (dce *DatabaseConnectionExhauster) ExhaustConnections(ctx context.Context, connStr string, maxConnections int) error {
	dce.mutex.Lock()
	defer dce.mutex.Unlock()

	level.Warn(dce.logger).Log("action", "exhausting_database_connections", "target_connections", maxConnections)

	for i := 0; i < maxConnections; i++ {
		// Open a new database connection
		db, err := otelsql.Open("postgres", connStr, otelsql.WithAttributes(
			semconv.DBSystemKey.String("postgres"),
		))
		if err != nil {
			level.Error(dce.logger).Log("connection_exhaustion_error", err, "connections_opened", i)
			return err
		}

		// Set connection pool settings to force individual connections
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
		db.SetConnMaxLifetime(time.Hour) // Keep connections alive

		// Test the connection to ensure it's actually established
		if err := db.PingContext(ctx); err != nil {
			level.Error(dce.logger).Log("connection_ping_error", err, "connection_number", i)
			db.Close()
			return err
		}

		// Store the connection
		dce.connections = append(dce.connections, db)

		// Add some delay to make it more realistic
		time.Sleep(10 * time.Millisecond)

		if i%10 == 0 {
			level.Info(dce.logger).Log("connections_opened", i+1, "target", maxConnections)
		}
	}

	level.Warn(dce.logger).Log("database_connections_exhausted", maxConnections)
	return nil
}

// ReleaseConnections closes all opened connections
func (dce *DatabaseConnectionExhauster) ReleaseConnections() {
	dce.mutex.Lock()
	defer dce.mutex.Unlock()

	level.Info(dce.logger).Log("action", "releasing_database_connections", "count", len(dce.connections))

	for i, db := range dce.connections {
		if err := db.Close(); err != nil {
			level.Error(dce.logger).Log("connection_close_error", err, "connection_number", i)
		}
	}

	dce.connections = dce.connections[:0] // Clear the slice
	level.Info(dce.logger).Log("database_connections_released", "success")
}

// GetConnectionCount returns the number of currently held connections
func (dce *DatabaseConnectionExhauster) GetConnectionCount() int {
	dce.mutex.Lock()
	defer dce.mutex.Unlock()
	return len(dce.connections)
}

// Global connection exhauster instance
var globalConnectionExhauster *DatabaseConnectionExhauster
var exhausterOnce sync.Once

// GetConnectionExhauster returns a singleton instance of the connection exhauster
func GetConnectionExhauster(logger log.Logger) *DatabaseConnectionExhauster {
	exhausterOnce.Do(func() {
		globalConnectionExhauster = NewDatabaseConnectionExhauster(logger)
	})
	return globalConnectionExhauster
}
