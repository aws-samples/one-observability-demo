#!/bin/bash

# Example script to test the payforadoption service with the new userid parameter

# Set the service URL (adjust as needed)
SERVICE_URL="http://localhost:80"

echo "Testing Complete Adoption API with User ID..."

# Test the complete adoption endpoint with all required parameters
curl -X POST "${SERVICE_URL}/api/completeadoption?petId=pet123&petType=dog&userId=user456" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\n\nTesting Health Check..."

# Test health check
curl -X GET "${SERVICE_URL}/health/status" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\n\nTesting with missing userId parameter (should return 400)..."

# Test with missing userId parameter (should fail)
curl -X POST "${SERVICE_URL}/api/completeadoption?petId=pet123&petType=dog" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\n\nTesting Error Mode scenarios (if enabled)..."

# Test different pet types to see various degradation scenarios
echo "Testing bunny (critical failure):"
curl -X POST "${SERVICE_URL}/api/completeadoption?petId=bunny1&petType=bunny&userId=user1" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\nTesting dog (intermittent failures):"
curl -X POST "${SERVICE_URL}/api/completeadoption?petId=dog1&petType=dog&userId=user2" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\nTesting cat (REAL database connection exhaustion - will impact database!):"
curl -X POST "${SERVICE_URL}/api/completeadoption?petId=cat1&petType=cat&userId=user3" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\nTesting impact during connection exhaustion (try another request immediately):"
curl -X POST "${SERVICE_URL}/api/completeadoption?petId=dog2&petType=dog&userId=user5" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\nTesting fish (partial degradation):"
curl -X POST "${SERVICE_URL}/api/completeadoption?petId=fish1&petType=fish&userId=user4" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\n\nNote: Error mode scenarios only activate when /petstore/errormode1 parameter is set to 'true'"
echo "Done!"