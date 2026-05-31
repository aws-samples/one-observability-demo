#!/bin/bash
# A/B Test Traffic Generator
# Usage: bash loadgen-ab-test.sh [count]

REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-default}"
TARGET="petfood-control"

# Resolve gateway ID dynamically
echo "Looking up gateway ID..."
GATEWAY_ID=$(aws bedrock-agentcore-control list-gateways --profile "$PROFILE" --region "$REGION" --output json 2>/dev/null \
  | python3 -c "import sys,json;data=json.load(sys.stdin);gws=data.get('items',data.get('gateways',[]));print(next((g['gatewayId'] for g in gws if 'PetFoodAB' in g['name']),''))" 2>/dev/null)

if [ -z "$GATEWAY_ID" ]; then
  echo "ERROR: Could not find PetFoodABGateway. Run setup-ab-test.py first."
  exit 1
fi

GATEWAY_URL="https://${GATEWAY_ID}.gateway.bedrock-agentcore.${REGION}.amazonaws.com/${TARGET}/invocations"

# Resolve credentials (works with any auth: role, SSO, profile, instance profile)
echo "Resolving credentials (profile: $PROFILE)..."
eval "$(aws configure export-credentials --profile "$PROFILE" --format env 2>/dev/null)"
if [ -z "$AWS_ACCESS_KEY_ID" ]; then
  echo "ERROR: Could not resolve credentials. Ensure 'aws sts get-caller-identity --profile $PROFILE' works."
  exit 1
fi
echo "Authenticated: $(aws sts get-caller-identity --profile "$PROFILE" --query Arn --output text 2>/dev/null)"

PROMPTS=(
  "What food is best for a Golden Retriever puppy?"
  "My senior cat has kidney issues, what should I feed her?"
  "I have an overweight Labrador, recommend a food"
  "What's good for an active Border Collie?"
  "Recommend food for a 2-month-old kitten"
  "My dog has grain allergies, what are my options?"
  "Best high-protein food for a German Shepherd?"
  "What do you recommend for a picky eater Poodle?"
  "My parrot needs a new diet, suggestions?"
  "Food recommendations for a Husky with sensitive stomach?"
)

echo "=== A/B Test Traffic Generator ==="
echo "Gateway: $GATEWAY_URL"

TOTAL=${1:-10}
echo "Sending ${TOTAL} requests..."
echo ""

for i in $(seq 1 $TOTAL); do
  PROMPT="${PROMPTS[$(( (i - 1) % ${#PROMPTS[@]} ))]}"
  SESSION_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
  echo "[$i/${TOTAL}] $PROMPT"

  RESPONSE=$(curl -s --aws-sigv4 "aws:amz:${REGION}:bedrock-agentcore" \
    --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
    -H "x-amz-security-token: ${AWS_SESSION_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: ${SESSION_ID}" \
    -d "{\"prompt\": \"${PROMPT}\"}" \
    -X POST \
    "${GATEWAY_URL}" 2>&1)

  echo "  Response: ${RESPONSE:0:100}..."
  echo ""
  sleep 3
done

echo "=== Done. Check A/B test results in AgentCore console in ~15 minutes ==="
