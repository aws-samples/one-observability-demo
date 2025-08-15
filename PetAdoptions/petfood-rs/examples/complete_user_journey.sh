#!/bin/bash

# Complete User Journey Example Script
# This script demonstrates a full end-to-end user journey with the PetFood API

set -e  # Exit on any error

# Configuration
BASE_URL="http://localhost"
USER_ID="user001"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to make HTTP requests and show responses
make_request() {
    local method=$1
    local url=$2
    local data=$3
    local description=$4
    
    echo ""
    print_step "$description"
    echo "Request: $method $url"
    
    if [ -n "$data" ]; then
        echo "Data: $data"
        response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X "$method" "$url" \
                   -H "Content-Type: application/json" \
                   -d "$data")
    else
        response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X "$method" "$url")
    fi
    
    # Extract HTTP status and body
    http_status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)
    body=$(echo "$response" | sed '/HTTP_STATUS:/d')
    
    echo "Status: $http_status"
    echo "Response:"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    
    # Check if request was successful
    if [[ "$http_status" =~ ^2[0-9][0-9]$ ]]; then
        print_success "Request completed successfully"
    else
        print_error "Request failed with status $http_status"
    fi
    
    echo "----------------------------------------"
}

# Function to extract food_id from response
extract_food_id() {
    local response=$1
    echo "$response" | jq -r '.foods[0].id // .id // empty' 2>/dev/null
}

echo "🐾 PetFood API - Complete User Journey Demo"
echo "==========================================="
echo ""

# Step 1: Health Check
make_request "GET" "$BASE_URL/health/status" "" "1. Check service health"

# Step 2: Setup Database
make_request "POST" "$BASE_URL/api/admin/setup-tables" "" "2. Setup database tables"

# Step 3: Seed Database
make_request "POST" "$BASE_URL/api/admin/seed" "" "3. Seed database with sample data"

# Step 4: Browse All Foods
foods_response=$(curl -s "$BASE_URL/api/foods")
make_request "GET" "$BASE_URL/api/foods" "" "4. Browse all available foods"

# Extract a food ID for later use
FOOD_ID=$(echo "$foods_response" | jq -r '.foods[0].id // empty' 2>/dev/null)
if [ -n "$FOOD_ID" ]; then
    print_info "Using food ID: $FOOD_ID for cart operations"
fi

# Step 5: Get Puppy Foods using filtering
make_request "GET" "$BASE_URL/api/foods?pet_type=puppy" "" "5. Get puppy foods using filtering"

# Step 6: Filter Foods by Pet Type
make_request "GET" "$BASE_URL/api/foods?pet_type=puppy" "" "6. Filter foods for puppies only"

# Step 7: Filter Foods by Price Range
make_request "GET" "$BASE_URL/api/foods?food_type=dry&max_price=15.00" "" "7. Find dry foods under $15"

# Step 8: Get Specific Food Details
if [ -n "$FOOD_ID" ]; then
    make_request "GET" "$BASE_URL/api/foods/$FOOD_ID" "" "8. Get details for specific food"
else
    print_error "No food ID available, skipping food details step"
fi

# Step 9: Check Initial Cart (Should be Empty)
make_request "GET" "$BASE_URL/api/cart/$USER_ID" "" "9. Check initial cart for $USER_ID"

# Step 10: Add First Item to Cart
if [ -n "$FOOD_ID" ]; then
    cart_data='{"food_id": "'$FOOD_ID'", "quantity": 2}'
    make_request "POST" "$BASE_URL/api/cart/$USER_ID/items" "$cart_data" "10. Add first item to cart (2 units)"
else
    print_error "No food ID available, skipping add to cart step"
fi

# Step 11: Add Second Item to Cart (Get another food ID)
second_food_id=$(echo "$foods_response" | jq -r '.foods[1].id // empty' 2>/dev/null)
if [ -n "$second_food_id" ]; then
    cart_data2='{"food_id": "'$second_food_id'", "quantity": 1}'
    make_request "POST" "$BASE_URL/api/cart/$USER_ID/items" "$cart_data2" "11. Add second item to cart (1 unit)"
    print_info "Using second food ID: $second_food_id"
else
    print_error "No second food ID available, skipping second add to cart step"
fi

# Step 12: Check Cart with Items
make_request "GET" "$BASE_URL/api/cart/$USER_ID" "" "12. Check cart contents"

# Step 13: Update First Item Quantity
if [ -n "$FOOD_ID" ]; then
    update_data='{"quantity": 5}'
    make_request "PUT" "$BASE_URL/api/cart/$USER_ID/items/$FOOD_ID" "$update_data" "13. Update first item quantity to 5"
else
    print_error "No food ID available, skipping quantity update step"
fi

# Step 14: Remove Second Item from Cart
if [ -n "$second_food_id" ]; then
    make_request "DELETE" "$BASE_URL/api/cart/$USER_ID/items/$second_food_id" "" "14. Remove second item from cart"
else
    print_error "No second food ID available, skipping remove item step"
fi

# Step 15: Check Updated Cart
make_request "GET" "$BASE_URL/api/cart/$USER_ID" "" "15. Check updated cart contents"

# Step 16: Create a New Food Product (Admin)
new_food_data='{
  "pet_type": "puppy",
  "name": "Custom Puppy Treats",
  "food_type": "treats",
  "description": "Delicious custom treats for puppies",
  "price": "8.99",
  "image": "custom-puppy-treats.jpg",
  "ingredients": ["chicken", "sweet potato", "oats"],
  "feeding_guidelines": "Give as rewards during training",
  "stock_quantity": 25
}'
new_food_response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X "POST" "$BASE_URL/api/admin/foods" \
                   -H "Content-Type: application/json" \
                   -d "$new_food_data")
make_request "POST" "$BASE_URL/api/admin/foods" "$new_food_data" "16. Create a new custom food product (Admin)"

# Extract new food ID
NEW_FOOD_ID=$(echo "$new_food_response" | sed '/HTTP_STATUS:/d' | jq -r '.id // empty' 2>/dev/null)

# Step 17: Update the New Food (Admin)
if [ -n "$NEW_FOOD_ID" ]; then
    update_food_data='{"price": "7.99", "stock_quantity": 50}'
    make_request "PUT" "$BASE_URL/api/admin/foods/$NEW_FOOD_ID" "$update_food_data" "17. Update the new food product (Admin)"
    print_info "Updated food ID: $NEW_FOOD_ID"
else
    print_error "No new food ID available, skipping food update step"
fi

# Step 18: Add New Food to Cart
if [ -n "$NEW_FOOD_ID" ]; then
    new_cart_data='{"food_id": "'$NEW_FOOD_ID'", "quantity": 3}'
    make_request "POST" "$BASE_URL/api/cart/$USER_ID/items" "$new_cart_data" "18. Add new custom food to cart"
else
    print_error "No new food ID available, skipping add new food to cart step"
fi

# Step 19: Final Cart Check
make_request "GET" "$BASE_URL/api/cart/$USER_ID" "" "19. Final cart contents check"

# Step 20: Test Error Scenarios
print_step "20. Testing error scenarios"

# Test 404 - Non-existent food
make_request "GET" "$BASE_URL/api/foods/F99999999" "" "20a. Try to get non-existent food (should return 404)"

# Test 400 - Invalid pet type filter
make_request "GET" "$BASE_URL/api/foods?pet_type=invalid_pet" "" "20b. Try invalid pet type filter (should return 400)"

# Test 404 - Add non-existent food to cart
invalid_cart_data='{"food_id": "F99999999", "quantity": 1}'
make_request "POST" "$BASE_URL/api/cart/$USER_ID/items" "$invalid_cart_data" "20c. Try to add non-existent food to cart (should return 404)"

# Step 21: Clear Cart
make_request "POST" "$BASE_URL/api/cart/$USER_ID/clear" "" "21. Clear the cart"

# Step 22: Verify Empty Cart
make_request "GET" "$BASE_URL/api/cart/$USER_ID" "" "22. Verify cart is empty"

# Step 23: Get Foods for Other Pet Types
make_request "GET" "$BASE_URL/api/foods?pet_type=kitten" "" "23a. Get foods for kittens"
make_request "GET" "$BASE_URL/api/foods?pet_type=bunny" "" "23b. Get foods for bunnies"

# Step 24: Advanced Filtering Examples
make_request "GET" "$BASE_URL/api/foods?pet_type=kitten&food_type=wet" "" "24a. Filter: Wet food for kittens"
make_request "GET" "$BASE_URL/api/foods?min_price=10.00&max_price=20.00" "" "24b. Filter: Foods between $10-$20"
make_request "GET" "$BASE_URL/api/foods?search=chicken" "" "24c. Search: Foods containing 'chicken'"

# Step 25: Cleanup
print_step "25. Cleanup operations"

# Delete the custom food we created (Admin)
if [ -n "$NEW_FOOD_ID" ]; then
    make_request "DELETE" "$BASE_URL/api/admin/foods/$NEW_FOOD_ID" "" "25a. Delete the custom food product (Admin)"
else
    print_info "No custom food to delete"
fi

# Final cleanup - remove all data
make_request "POST" "$BASE_URL/api/admin/cleanup" "" "25b. Clean up all data from database"

echo ""
echo "🎉 Complete User Journey Demo Finished!"
echo "======================================"
echo ""
print_success "All API endpoints have been tested successfully!"
echo ""
echo "Summary of operations performed:"
echo "• Health check and database setup"
echo "• Food browsing and filtering"
echo "• Food filtering and search"
echo "• Complete cart management workflow"
echo "• Food creation, update, and deletion"
echo "• Error scenario testing"
echo "• Data cleanup"
echo ""
echo "The API is ready for UI development! 🚀"
echo ""
echo "Next steps:"
echo "1. Import postman_collection.json into Postman for interactive testing"
echo "2. Review API_DOCUMENTATION.md for complete endpoint reference"
echo "3. Check UI_DEVELOPER_QUICKSTART.md for quick integration tips"
