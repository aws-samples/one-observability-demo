#!/bin/bash

# Example script to test the payforadoption service with the new userid parameter

# Set the service URL (adjust as needed)
SERVICE_URL="http://localhost:80"

echo "Testing Complete Adoption API with User ID..."

# Test the complete adoption endpoint with all required parameters
curl -X POST "${SERVICE_URL}/api/home/completeadoption?petId=pet123&petType=dog&userId=user456" \
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
curl -X POST "${SERVICE_URL}/api/home/completeadoption?petId=pet123&petType=dog" \
  -H "Content-Type: application/json" \
  -w "\nHTTP Status: %{http_code}\n" \
  -s

echo -e "\n\nDone!"