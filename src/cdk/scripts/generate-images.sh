#!/bin/bash
# Unified Pet Image Generation Script (Bash version)
# Generates images for bunnies, kittens, puppies, and petfood using AWS CLI and Bedrock

set -e  # Exit on any error

# Configuration
BEDROCK_MODEL_ID="amazon.nova-canvas-v1:0"
BEDROCK_REGION="us-east-1"
DEFAULT_OUTPUT_DIR="generated_images"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Set directories - make them absolute relative to script directory
OUTPUT_DIR="$SCRIPT_DIR/$DEFAULT_OUTPUT_DIR"
STATIC_DIR="$SCRIPT_DIR/../../../static/images"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Help function
show_help() {
    cat << EOF
Pet Image Generation Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --type CATEGORIES     Comma-separated categories (bunnies,kittens,puppies,petfood)
    --output-dir DIR      Output directory for generated images (default: script_dir/generated_images)
    --validate-only       Only validate current images, don't generate new ones
    --create-zips         Create zip files after generation
    --region REGION       AWS region (default: $BEDROCK_REGION)
    --help               Show this help message

EXAMPLES:
    $0                                    # Generate all missing images
    $0 --type kittens,puppies            # Generate only kittens and puppies
    $0 --validate-only                   # Check current status
    $0 --type petfood --create-zips      # Generate petfood and create zip

REQUIREMENTS:
    - AWS CLI v2 with Bedrock support
    - AWS credentials configured
    - jq (for JSON processing)
EOF
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install AWS CLI v2."
        exit 1
    fi

    # Check jq
    if ! command -v jq &> /dev/null; then
        log_error "jq not found. Please install jq for JSON processing."
        log_info "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
        exit 1
    fi

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials not configured or invalid."
        log_info "Please run 'aws configure' or set environment variables."
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# Check Bedrock model access
check_bedrock_access() {
    log_info "Checking Bedrock model access..."

    # Test if we can list foundation models
    log_info "Testing Bedrock access with: aws bedrock list-foundation-models --region $BEDROCK_REGION"

    local bedrock_test_output
    if ! bedrock_test_output=$(aws bedrock list-foundation-models --region "$BEDROCK_REGION" 2>&1); then
        log_error "Cannot access Bedrock in region $BEDROCK_REGION"
        log_error "AWS CLI Error: $bedrock_test_output"
        log_info "Please ensure:"
        log_info "1. You have Bedrock permissions"
        log_info "2. You're in a supported region"
        log_info "3. Your AWS CLI version supports Bedrock (must be v2)"

        # Show current AWS identity
        local identity_info
        if identity_info=$(aws sts get-caller-identity 2>&1); then
            log_info "Current AWS identity: $identity_info"
        else
            log_error "Cannot determine AWS identity: $identity_info"
        fi
        exit 1
    fi

    log_success "Successfully listed foundation models"

    # Check if Titan Image Generator v2 is available
    log_info "Checking for model $BEDROCK_MODEL_ID availability..."

    local available_models
    available_models=$(aws bedrock list-foundation-models --region "$BEDROCK_REGION" --query "modelSummaries[?modelId=='$BEDROCK_MODEL_ID'].modelId" --output text 2>&1)

    if [[ -z "$available_models" || "$available_models" != *"$BEDROCK_MODEL_ID"* ]]; then
        log_error "Model $BEDROCK_MODEL_ID not available in $BEDROCK_REGION"
        log_error "Model query result: $available_models"

        # List available image generation models
        local image_models
        image_models=$(aws bedrock list-foundation-models --region "$BEDROCK_REGION" --query "modelSummaries[?contains(modelId, 'image')].{ModelId:modelId,Status:modelLifecycle.status}" --output table 2>&1)
        log_info "Available image models in $BEDROCK_REGION:"
        echo "$image_models"

        log_info "Available regions for Titan Image Generator: us-east-1, us-west-2"
        exit 1
    fi

    log_success "Model $BEDROCK_MODEL_ID is available"
    log_success "Bedrock access verified"
}

# Load and parse seed data
load_seed_data() {
    log_info "Loading seed data..."

    # Check if seed files exist
    if [[ ! -f "$SCRIPT_DIR/seed.json" ]]; then
        log_error "seed.json not found in $SCRIPT_DIR"
        exit 1
    fi

    if [[ ! -f "$SCRIPT_DIR/petfood-seed.json" ]]; then
        log_error "petfood-seed.json not found in $SCRIPT_DIR"
        exit 1
    fi

    log_success "Seed data files found"
}

# Generate contextual prompts based on category and data
generate_prompt() {
    local category="$1"
    local item_data="$2"

    case "$category" in
        "bunny")
            local color=$(echo "$item_data" | jq -r '.petcolor // "brown"')
            local description=$(echo "$item_data" | jq -r '.description // ""')
            local personality_hint=""

            # Extract key personality traits for visual representation
            if [[ "$description" == *"energetic"* || "$description" == *"playful"* ]]; then
                personality_hint="in an active, alert pose"
            elif [[ "$description" == *"calm"* || "$description" == *"gentle"* ]]; then
                personality_hint="in a peaceful, relaxed position"
            elif [[ "$description" == *"social"* || "$description" == *"friendly"* ]]; then
                personality_hint="with an approachable, friendly expression"
            elif [[ "$description" == *"intelligent"* || "$description" == *"independent"* ]]; then
                personality_hint="with an attentive, thoughtful expression"
            else
                personality_hint="in a natural, comfortable pose"
            fi

            echo "Adorable fluffy $color bunny $personality_hint, professional pet photography, clean background, high resolution"
            ;;
        "kitten")
            local color=$(echo "$item_data" | jq -r '.petcolor // "gray"')
            local description=$(echo "$item_data" | jq -r '.description // ""')
            local personality_hint=""
            local pose_style=""

            # Extract personality for visual cues
            if [[ "$description" == *"playful"* || "$description" == *"mischievous"* ]]; then
                personality_hint="with bright, playful eyes"
                pose_style="in an active, curious pose"
            elif [[ "$description" == *"sleepy"* || "$description" == *"cuddly"* ]]; then
                personality_hint="with gentle, drowsy eyes"
                pose_style="in a cozy, relaxed position"
            elif [[ "$description" == *"adventurous"* || "$description" == *"bold"* ]]; then
                personality_hint="with confident, alert eyes"
                pose_style="in an upright, confident stance"
            elif [[ "$description" == *"quiet"* || "$description" == *"observant"* ]]; then
                personality_hint="with calm, watchful eyes"
                pose_style="in a still, observant position"
            elif [[ "$description" == *"energetic"* || "$description" == *"athletic"* ]]; then
                personality_hint="with bright, active eyes"
                pose_style="in a dynamic, ready-to-move pose"
            elif [[ "$description" == *"affectionate"* || "$description" == *"social"* ]]; then
                personality_hint="with warm, loving eyes"
                pose_style="in a welcoming, approachable position"
            elif [[ "$description" == *"independent"* || "$description" == *"elegant"* ]]; then
                personality_hint="with dignified, composed eyes"
                pose_style="in a graceful, poised stance"
            else
                personality_hint="with bright curious eyes"
                pose_style="in a natural pose"
            fi

            echo "Cute kitten with $color fur $personality_hint $pose_style, professional pet photography, clean background, high resolution"
            ;;
        "puppy")
            local color=$(echo "$item_data" | jq -r '.petcolor // "brown"')
            local description=$(echo "$item_data" | jq -r '.description // ""')
            local personality_hint=""
            local expression_style=""

            # Extract personality traits for visual representation
            if [[ "$description" == *"high-energy"* || "$description" == *"athletic"* ]]; then
                personality_hint="with energetic, alert expression"
                expression_style="in a dynamic, ready-for-action pose"
            elif [[ "$description" == *"loyal"* || "$description" == *"protective"* ]]; then
                personality_hint="with noble, attentive expression"
                expression_style="in a confident, watchful stance"
            elif [[ "$description" == *"friendly"* || "$description" == *"social"* ]]; then
                personality_hint="with warm, welcoming expression"
                expression_style="in an approachable, tail-wagging pose"
            elif [[ "$description" == *"calm"* || "$description" == *"gentle"* ]]; then
                personality_hint="with peaceful, serene expression"
                expression_style="in a relaxed, comfortable position"
            elif [[ "$description" == *"playful"* || "$description" == *"curious"* ]]; then
                personality_hint="with bright, inquisitive expression"
                expression_style="in an active, exploring pose"
            elif [[ "$description" == *"intelligent"* || "$description" == *"trainable"* ]]; then
                personality_hint="with focused, attentive expression"
                expression_style="in an alert, learning stance"
            elif [[ "$description" == *"sleepy"* || "$description" == *"relaxed"* ]]; then
                personality_hint="with drowsy, content expression"
                expression_style="in a cozy, resting position"
            elif [[ "$description" == *"adventurous"* ]]; then
                personality_hint="with bold, confident expression"
                expression_style="in an explorer's ready stance"
            elif [[ "$description" == *"affectionate"* || "$description" == *"cuddly"* ]]; then
                personality_hint="with loving, sweet expression"
                expression_style="in a snuggly, heart-melting pose"
            elif [[ "$description" == *"independent"* || "$description" == *"confident"* ]]; then
                personality_hint="with self-assured, dignified expression"
                expression_style="in a proud, independent stance"
            elif [[ "$description" == *"gentle"* || "$description" == *"patient"* ]]; then
                personality_hint="with kind, patient expression"
                expression_style="in a calm, family-friendly pose"
            elif [[ "$description" == *"alert"* || "$description" == *"watchful"* ]]; then
                personality_hint="with vigilant, attentive expression"
                expression_style="in a guard-like, observant stance"
            elif [[ "$description" == *"smart"* || "$description" == *"eager"* ]]; then
                personality_hint="with intelligent, eager-to-please expression"
                expression_style="in an attentive, learning pose"
            elif [[ "$description" == *"therapeutic"* ]]; then
                personality_hint="with calming, empathetic expression"
                expression_style="in a comforting, supportive position"
            else
                personality_hint="with happy energetic expression"
                expression_style="in a natural pose"
            fi

            echo "Playful puppy with $color coat $personality_hint $expression_style, professional pet photography, clean background, high resolution"
            ;;
        "petfood")
            local name=$(echo "$item_data" | jq -r '.name // "Premium Pet Food"')
            local food_type=$(echo "$item_data" | jq -r '.food_type // "dry"')
            local pet_type=$(echo "$item_data" | jq -r '.pet_type // "dog"')

            case "$food_type" in
                "wet")
                    local food_desc="gourmet wet food with rich, glossy appearance"
                    ;;
                "treat")
                    local food_desc="delicious pet treats scattered artfully"
                    ;;
                *)
                    local food_desc="premium dry pet food with visible kibble pieces"
                    ;;
            esac

            case "$pet_type" in
                "cat")
                    local bowl_style="elegant cat food bowl"
                    ;;
                "kitten")
                    local bowl_style="small kitten bowl"
                    ;;
                "puppy")
                    local bowl_style="puppy feeding bowl"
                    ;;
                *)
                    local bowl_style="ceramic pet bowl"
                    ;;
            esac

            echo "$food_desc in $bowl_style, appetizing and fresh appearance, clean product photography, natural lighting, appealing presentation, clean white background, high resolution, commercial quality"
            ;;
        *)
            echo "Professional $category photography, clean white background, high resolution"
            ;;
    esac
}

# Generate a single image
generate_single_image() {
    local prompt="$1"
    local filename="$2"
    local max_retries=3

    mkdir -p "$OUTPUT_DIR"

    for ((attempt=1; attempt<=max_retries; attempt++)); do
        log_info "Generating $filename (attempt $attempt/$max_retries)..."
        log_info "Using prompt: ${prompt:0:100}..."

        # Create Bedrock request - properly escape JSON
        local seed_value=$((RANDOM * RANDOM))

        # Escape the prompt for JSON
        local escaped_prompt=$(echo "$prompt" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed 's/\t/\\t/g' | sed 's/\n/\\n/g' | sed 's/\r/\\r/g')

        # Create request body with proper JSON formatting for Nova Canvas
        local temp_request="/tmp/bedrock_request_$$.json"
        cat > "$temp_request" << EOF
{
    "taskType": "TEXT_IMAGE",
    "textToImageParams": {
        "text": "$escaped_prompt",
        "negativeText": "blurry, low quality, distorted, ugly, deformed"
    },
    "imageGenerationConfig": {
        "numberOfImages": 1,
        "quality": "standard",
        "height": 512,
        "width": 512,
        "cfgScale": 8.0,
        "seed": $seed_value
    }
}
EOF

        # Validate JSON format
        if ! jq empty "$temp_request" 2>/dev/null; then
            log_error "Invalid JSON format in request body"
            log_error "Request content: $(cat "$temp_request")"
            rm -f "$temp_request"
            return 1
        fi

        log_info "Generated valid JSON request body"

        local request_size=$(stat -f%z "$temp_request" 2>/dev/null || stat -c%s "$temp_request" 2>/dev/null || echo "unknown")
        log_info "Request body size: $request_size bytes"
        log_info "Using seed: $seed_value"

        # Call Bedrock with detailed logging
        local temp_response="/tmp/bedrock_response_$$.json"
        local temp_error="/tmp/bedrock_error_$$.txt"

        log_info "Calling Bedrock API: aws bedrock-runtime invoke-model --region $BEDROCK_REGION --model-id $BEDROCK_MODEL_ID"

        # Show first part of request for debugging
        log_info "Request preview: $(head -c 200 "$temp_request")"

        # Base64 encode the JSON request as required by AWS CLI
        local encoded_body
        encoded_body=$(base64 -i "$temp_request")
        log_info "Encoded request body (first 100 chars): ${encoded_body:0:100}..."

        local bedrock_exit_code=0
        if aws bedrock-runtime invoke-model \
            --region "$BEDROCK_REGION" \
            --model-id "$BEDROCK_MODEL_ID" \
            --body "$encoded_body" \
            "$temp_response" 2>"$temp_error"; then

            log_success "Bedrock API call successful"

            # Check if response file exists and has content
            if [[ ! -f "$temp_response" ]]; then
                log_error "Response file not created: $temp_response"
                return 1
            fi

            local response_size=$(stat -f%z "$temp_response" 2>/dev/null || stat -c%s "$temp_response" 2>/dev/null || echo "0")
            log_info "Response file size: $response_size bytes"

            if [[ $response_size -eq 0 ]]; then
                log_error "Empty response file"
                return 1
            fi

            # Show first part of response for debugging (without image data)
            local response_preview
            response_preview=$(head -c 500 "$temp_response" | tr -d '\0' | sed 's/[^[:print:]]/?/g')
            log_info "Response preview: $response_preview"

            # Extract and decode image
            local image_data
            if ! image_data=$(jq -r '.images[0]' "$temp_response" 2>&1); then
                log_error "Failed to parse JSON response: $image_data"
                log_error "Raw response content (first 1000 chars): $(head -c 1000 "$temp_response")"
                rm -f "$temp_response" "$temp_error"
                return 1
            fi

            if [[ "$image_data" == "null" || -z "$image_data" ]]; then
                log_error "No image data found in response"
                log_error "Full response: $(cat "$temp_response")"
                rm -f "$temp_response" "$temp_error"
                return 1
            fi

            log_info "Image data length: ${#image_data} characters"

            # Decode base64 image data
            if echo "$image_data" | base64 -d > "$OUTPUT_DIR/$filename" 2>&1; then
                local file_size=$(stat -f%z "$OUTPUT_DIR/$filename" 2>/dev/null || stat -c%s "$OUTPUT_DIR/$filename" 2>/dev/null || echo "unknown")
                log_success "Generated $filename ($file_size bytes)"
                rm -f "$temp_response" "$temp_error"
                return 0
            else
                log_error "Failed to decode base64 image data"
                rm -f "$temp_response" "$temp_error"
                return 1
            fi

        else
            bedrock_exit_code=$?
            log_error "Bedrock API call failed with exit code: $bedrock_exit_code"

            if [[ -f "$temp_error" ]]; then
                local error_content
                error_content=$(cat "$temp_error")
                log_error "Error details: $error_content"

                # Check for common error patterns
                if [[ "$error_content" == *"ValidationException"* ]]; then
                    log_error "Validation error - check request format and model availability"
                elif [[ "$error_content" == *"AccessDeniedException"* ]]; then
                    log_error "Access denied - check IAM permissions for Bedrock"
                elif [[ "$error_content" == *"ThrottlingException"* ]]; then
                    log_warning "Request throttled - will retry with backoff"
                elif [[ "$error_content" == *"ModelNotReadyException"* ]]; then
                    log_error "Model not ready - ensure model access is enabled in Bedrock console"
                fi
            fi

            rm -f "$temp_response" "$temp_error" "$temp_request"
        fi

        if [[ $attempt -lt $max_retries ]]; then
            local delay=$((attempt * 3))
            log_info "Retrying in ${delay}s..."
            sleep $delay
        fi
    done

    log_error "Failed to generate $filename after $max_retries attempts"
    return 1
}

# Generate images for a category
generate_category() {
    local category="$1"
    log_info "Processing category: $category"

    local seed_file
    case "$category" in
        "bunny"|"kitten"|"puppy")
            seed_file="$SCRIPT_DIR/seed.json"
            ;;
        "petfood")
            seed_file="$SCRIPT_DIR/petfood-seed.json"
            ;;
        *)
            log_error "Unknown category: $category"
            return 1
            ;;
    esac

    local items
    if [[ "$category" == "petfood" ]]; then
        items=$(jq -c '.[]' "$seed_file")
    else
        items=$(jq -c ".[] | select(.pettype == \"$category\")" "$seed_file")
    fi

    if [[ -z "$items" ]]; then
        log_error "No items found for category: $category"
        return 1
    fi

    local success_count=0
    local total_count=0

    while IFS= read -r item; do
        ((total_count++))

        # Determine filename
        local filename
        if [[ "$category" == "petfood" ]]; then
            local food_id=$(echo "$item" | jq -r '.id')
            local image_num=${food_id#F}
            filename="f${image_num#0}.jpg"
        else
            local image_code=$(echo "$item" | jq -r '.image')
            filename="${image_code}.jpg"
        fi

        # Skip if already exists
        if [[ -f "$OUTPUT_DIR/$filename" ]]; then
            log_success "$filename already exists, skipping"
            ((success_count++))
            continue
        fi

        # Generate prompt
        local prompt=$(generate_prompt "$category" "$item")
        log_info "Prompt: ${prompt:0:100}..."

        # Generate image
        if generate_single_image "$prompt" "$filename"; then
            ((success_count++))
        fi

        # Small delay between generations to avoid rate limiting
        sleep 1
    done <<< "$items"

    log_info "Generated $success_count/$total_count images for $category"
    [[ $success_count -eq $total_count ]]
}

# Create zip file for category
create_zip_file() {
    local category="$1"
    log_info "Creating zip file for $category..."

    # Determine expected files
    local seed_file
    case "$category" in
        "bunny"|"kitten"|"puppy")
            seed_file="$SCRIPT_DIR/seed.json"
            ;;
        "petfood")
            seed_file="$SCRIPT_DIR/petfood-seed.json"
            ;;
        *)
            log_error "Unknown category: $category"
            return 1
            ;;
    esac

    local expected_files=()
    if [[ "$category" == "petfood" ]]; then
        while IFS= read -r item; do
            local food_id=$(echo "$item" | jq -r '.id')
            local image_num=${food_id#F}
            expected_files+=("f${image_num#0}.jpg")
        done <<< "$(jq -c '.[]' "$seed_file")"
    else
        while IFS= read -r item; do
            local image_code=$(echo "$item" | jq -r '.image')
            expected_files+=("${image_code}.jpg")
        done <<< "$(jq -c ".[] | select(.pettype == \"$category\")" "$seed_file")"
    fi

    # Check if all files exist
    local missing_files=()
    for file in "${expected_files[@]}"; do
        if [[ ! -f "$OUTPUT_DIR/$file" ]]; then
            missing_files+=("$file")
        fi
    done

    if [[ ${#missing_files[@]} -gt 0 ]]; then
        log_error "Missing files for $category: ${missing_files[*]}"
        return 1
    fi

    # Create zip file - ensure static directory exists with absolute path
    local abs_static_dir="$(cd "$SCRIPT_DIR" && cd "$STATIC_DIR" && pwd)"
    if [[ ! -d "$abs_static_dir" ]]; then
        log_info "Creating static directory: $abs_static_dir"
        mkdir -p "$abs_static_dir"
    fi

    local zip_name
    if [[ "$category" == "petfood" ]]; then
        zip_name="petfood.zip"
    else
        zip_name="${category}s.zip"  # bunny -> bunnies, kitten -> kittens, puppy -> puppies
    fi

    local zip_path="$abs_static_dir/$zip_name"
    log_info "Creating zip at: $zip_path"

    # Change to output directory for clean zip structure
    (cd "$OUTPUT_DIR" && zip -j "$zip_path" "${expected_files[@]}")

    log_success "Created $zip_path with ${#expected_files[@]} images"
    return 0
}

# Clean up generated images after zip creation
cleanup_generated_images() {
    log_info "Cleaning up generated images..."

    if [[ -d "$OUTPUT_DIR" ]]; then
        local file_count=$(find "$OUTPUT_DIR" -name "*.jpg" | wc -l)
        if [[ $file_count -gt 0 ]]; then
            log_info "Removing $file_count generated image files from $OUTPUT_DIR"
            rm -rf "$OUTPUT_DIR"
            log_success "Generated images directory cleaned up successfully"
        else
            log_info "No image files found in $OUTPUT_DIR to clean up"
        fi
    else
        log_info "Generated images directory $OUTPUT_DIR does not exist"
    fi
}

# Validate current image counts
validate_counts() {
    log_info "Validating image counts..."

    # Debug: Show actual paths
    log_info "Script directory: $SCRIPT_DIR"
    log_info "Static directory (relative): $STATIC_DIR"
    log_info "Static directory (absolute): $(cd "$SCRIPT_DIR" && cd "$STATIC_DIR" 2>/dev/null && pwd || echo "PATH NOT FOUND")"

    echo
    echo "📊 Validation Results:"
    echo "─────────────────────────────────"

    local categories=("bunny" "kitten" "puppy" "petfood")
    local all_good=true

    for category in "${categories[@]}"; do
        local seed_file
        case "$category" in
            "bunny"|"kitten"|"puppy")
                seed_file="$SCRIPT_DIR/seed.json"
                ;;
            "petfood")
                seed_file="$SCRIPT_DIR/petfood-seed.json"
                ;;
        esac

        local expected_count
        if [[ "$category" == "petfood" ]]; then
            expected_count=$(jq '. | length' "$seed_file")
        else
            expected_count=$(jq "[.[] | select(.pettype == \"$category\")] | length" "$seed_file")
        fi

        # Check for existing zip file first
        local zip_name
        if [[ "$category" == "petfood" ]]; then
            zip_name="petfood.zip"
        else
            zip_name="${category}s.zip"  # bunny -> bunnies, kitten -> kittens, puppy -> puppies
        fi

        local zip_path="$STATIC_DIR/$zip_name"
        local generated_count=0

        # If zip file exists, extract and count images
        if [[ -f "$zip_path" ]]; then
            log_info "Found existing $zip_name, extracting to validate..."
            mkdir -p "$OUTPUT_DIR"

            # Extract zip to temp location and count
            local temp_extract="/tmp/validate_$$"
            mkdir -p "$temp_extract"
            if unzip -q "$zip_path" -d "$temp_extract" 2>/dev/null; then
                generated_count=$(find "$temp_extract" -name "*.jpg" | wc -l)
                # Copy images to output directory if not present
                cp "$temp_extract"/*.jpg "$OUTPUT_DIR/" 2>/dev/null || true
                rm -rf "$temp_extract"
            else
                log_warning "Failed to extract $zip_name"
            fi
        else
            # Count generated files in output directory
            if [[ "$category" == "petfood" ]]; then
                while IFS= read -r item; do
                    local food_id=$(echo "$item" | jq -r '.id')
                    local image_num=${food_id#F}
                    local filename="f${image_num#0}.jpg"
                    if [[ -f "$OUTPUT_DIR/$filename" ]]; then
                        ((generated_count++))
                    fi
                done <<< "$(jq -c '.[]' "$seed_file")"
            else
                while IFS= read -r item; do
                    local image_code=$(echo "$item" | jq -r '.image')
                    local filename="${image_code}.jpg"
                    if [[ -f "$OUTPUT_DIR/$filename" ]]; then
                        ((generated_count++))
                    fi
                done <<< "$(jq -c ".[] | select(.pettype == \"$category\")" "$seed_file")"
            fi
        fi

        local status="❌"
        if [[ $generated_count -eq $expected_count ]]; then
            status="✅"
        else
            all_good=false
        fi

        # Capitalize first letter for display
        local display_category="$(echo "${category:0:1}" | tr '[:lower:]' '[:upper:]')${category:1}"
        local source_info=""
        if [[ -f "$zip_path" ]]; then
            source_info=" (from zip)"
        fi
        printf "%s %-8s: %d/%d images%s\n" "$status" "$display_category" "$generated_count" "$expected_count" "$source_info"
    done

    echo
    if $all_good; then
        log_success "All image counts are correct!"
    else
        log_warning "Some images are missing"
    fi
}

# Parse command line arguments
CATEGORIES=""
VALIDATE_ONLY=false
CREATE_ZIPS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --type)
            CATEGORIES="$2"
            shift 2
            ;;
        --output-dir)
            # Make output directory absolute if not already
            if [[ "$2" = /* ]]; then
                OUTPUT_DIR="$2"
            else
                OUTPUT_DIR="$(pwd)/$2"
            fi
            shift 2
            ;;
        --validate-only)
            VALIDATE_ONLY=true
            shift
            ;;
        --create-zips)
            CREATE_ZIPS=true
            shift
            ;;
        --region)
            BEDROCK_REGION="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
main() {
    log_info "Pet Image Generation Script Starting..."

    # Check prerequisites
    check_prerequisites
    check_bedrock_access
    load_seed_data

    # Determine categories to process
    local all_categories=("bunny" "kitten" "puppy" "petfood")
    local process_categories=()

    if [[ -n "$CATEGORIES" ]]; then
        IFS=',' read -ra process_categories <<< "$CATEGORIES"
        # Validate categories
        for cat in "${process_categories[@]}"; do
            if [[ ! " ${all_categories[*]} " =~ " ${cat} " ]]; then
                log_error "Invalid category: $cat"
                log_info "Valid categories: ${all_categories[*]}"
                exit 1
            fi
        done
    else
        process_categories=("${all_categories[@]}")
    fi

    # Validation mode
    if $VALIDATE_ONLY; then
        validate_counts
        return 0
    fi

    # Generate images
    log_info "Processing categories: ${process_categories[*]}"

    local success_categories=()
    local failed_categories=()

    for category in "${process_categories[@]}"; do
        echo
        if generate_category "$category"; then
            success_categories+=("$category")
            # Capitalize first letter for display
            local display_category="$(echo "${category:0:1}" | tr '[:lower:]' '[:upper:]')${category:1}"
            log_success "$display_category generation completed"
        else
            failed_categories+=("$category")
            # Capitalize first letter for display
            local display_category="$(echo "${category:0:1}" | tr '[:lower:]' '[:upper:]')${category:1}"
            log_error "$display_category generation failed"
        fi
    done

    # Auto-create zip files after successful generation (unless --create-zips was explicitly provided)
    if [[ ${#success_categories[@]} -gt 0 && $CREATE_ZIPS == false ]]; then
        echo
        log_info "Auto-creating zip files for generated categories..."
        CREATE_ZIPS=true  # Enable zip creation for the next step
    fi

    # Create zip files if requested
    if $CREATE_ZIPS; then
        echo
        log_info "Creating zip files..."
        local zip_success_count=0
        for category in "${success_categories[@]}"; do
            if create_zip_file "$category"; then
                log_success "Created ${category}.zip"
                ((zip_success_count++))
            else
                log_error "Failed to create ${category}.zip"
            fi
        done

        # Clean up generated images after successful zip creation
        if [[ $zip_success_count -eq ${#success_categories[@]} ]]; then
            log_info "All zip files created successfully, cleaning up generated images..."
            cleanup_generated_images
        else
            log_warning "Some zip files failed to create, keeping generated images for debugging"
        fi
    fi

    # Final validation
    echo
    validate_counts

    # Summary
    echo
    if [[ ${#failed_categories[@]} -gt 0 ]]; then
        log_error "Failed categories: ${failed_categories[*]}"
        exit 1
    else
        log_success "All categories completed successfully! 🎉"
    fi
}

# Run main function
main "$@"
