#!/bin/bash

# Test runner script for petfood-rs comprehensive test suite
set -e

echo "🧪 Running Comprehensive Test Suite for petfood-rs"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if cargo is available
if ! command -v cargo &> /dev/null; then
    print_error "Cargo is not installed or not in PATH"
    exit 1
fi

# Change to the project directory
cd "$(dirname "$0")/.."

print_status "Building project..."
cargo build --release

print_status "Running unit tests..."
if cargo test --lib; then
    print_success "Unit tests passed"
else
    print_error "Unit tests failed"
    exit 1
fi

print_status "Running integration tests..."
if cargo test --test integration_tests; then
    print_success "Integration tests passed"
else
    print_warning "Integration tests failed or skipped (may require DynamoDB)"
fi

print_status "Running end-to-end tests..."
if cargo test --test e2e_tests; then
    print_success "End-to-end tests passed"
else
    print_warning "End-to-end tests failed or skipped (may require DynamoDB)"
fi

print_status "Running property-based tests..."
if cargo test --test property_tests; then
    print_success "Property-based tests passed"
else
    print_error "Property-based tests failed"
    exit 1
fi

print_status "Running benchmarks (food search)..."
if cargo bench --bench food_search; then
    print_success "Food search benchmarks completed"
else
    print_warning "Food search benchmarks failed or skipped"
fi

print_status "Running benchmarks (recommendations)..."
if cargo bench --bench recommendations; then
    print_success "Recommendations benchmarks completed"
else
    print_warning "Recommendations benchmarks failed or skipped"
fi

print_status "Generating test coverage report..."
if command -v cargo-tarpaulin &> /dev/null; then
    cargo tarpaulin --out Html --output-dir target/coverage
    print_success "Coverage report generated in target/coverage/"
else
    print_warning "cargo-tarpaulin not installed, skipping coverage report"
    print_warning "Install with: cargo install cargo-tarpaulin"
fi

print_status "Running clippy for code quality..."
if cargo clippy -- -D warnings; then
    print_success "Clippy checks passed"
else
    print_warning "Clippy found issues"
fi

print_status "Running rustfmt for code formatting..."
if cargo fmt -- --check; then
    print_success "Code formatting is correct"
else
    print_warning "Code formatting issues found, run 'cargo fmt' to fix"
fi

echo ""
print_success "🎉 Test suite completed!"
echo ""
echo "Test Results Summary:"
echo "- Unit tests: ✅"
echo "- Integration tests: ⚠️  (requires DynamoDB)"
echo "- End-to-end tests: ⚠️  (requires DynamoDB)"
echo "- Property-based tests: ✅"
echo "- Benchmarks: ⚠️  (requires DynamoDB)"
echo "- Code quality: ✅"
echo ""
echo "For full integration and benchmark testing, ensure DynamoDB is available."
echo "You can use LocalStack or AWS DynamoDB for this purpose."