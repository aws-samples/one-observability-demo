"""Pet Food Recommendation Agent using Amazon Bedrock AgentCore and Strands SDK."""

import os
import boto3
import logging
from opentelemetry import trace
from strands import Agent
from strands_tools import http_request
from strands.models import BedrockModel
from strands.agent.conversation_manager import SummarizingConversationManager
from bedrock_agentcore.runtime import BedrockAgentCoreApp

logger = logging.getLogger(__name__)

# Configuration
PARAMETER_STORE_PREFIX = os.environ.get("PARAMETER_STORE_PREFIX")
if not PARAMETER_STORE_PREFIX:
    raise RuntimeError("Required environment variable PARAMETER_STORE_PREFIX not set")
MODEL_ID = "us.anthropic.claude-sonnet-4-6"

# Initialize SSM client
REGION = os.environ.get("AWS_REGION", "us-east-1")
ssm_client = boto3.client("ssm", region_name=REGION)


def get_ssm_parameter(parameter_name: str) -> str:
    """Get parameter value from SSM Parameter Store."""
    try:
        full_parameter_name = f"{PARAMETER_STORE_PREFIX}/{parameter_name}"
        response = ssm_client.get_parameter(Name=full_parameter_name)
        logger.info(f"Retrieving SSM parameter: {full_parameter_name}")
        return response["Parameter"]["Value"]
    except ssm_client.exceptions.ParameterNotFound:
        raise RuntimeError(f"Required SSM parameter not found: {parameter_name}")
    except Exception as e:
        raise RuntimeError(f"Error retrieving SSM parameter {parameter_name}: {e}")


# Fetch API URLs from Parameter Store
search_api_url_parameter_name = os.environ.get("SEARCH_API_URL_PARAMETER_NAME")
if not search_api_url_parameter_name:
    raise RuntimeError(
        "Required environment variable SEARCH_API_URL_PARAMETER_NAME not set",
    )
petfood_api_url_parameter_name = os.environ.get("PETFOOD_API_URL_PARAMETER_NAME")
if not petfood_api_url_parameter_name:
    raise RuntimeError(
        "Required environment variable PETFOOD_API_URL_PARAMETER_NAME not set",
    )

search_api_url = get_ssm_parameter(search_api_url_parameter_name)
petfood_api_url = get_ssm_parameter(petfood_api_url_parameter_name)

# System prompt
SYSTEM_PROMPT = f"""You are Waggle, a friendly and knowledgeable pet food \
recommendation assistant. You're here to help pet parents find the perfect food \
for their furry, feathered, or scaled companions!

Your process:
1. First get pet details from {search_api_url}
2. Then get available foods from {petfood_api_url}
3. Match pet characteristics (age, size, breed, health conditions) with \
appropriate food types
4. Consider nutritional needs, dietary restrictions, and preferences
5. Provide clear reasoning for each recommendation

When helping users:
- Be conversational and friendly, not formal or robotic
- Ask clarifying questions if you need more information about their pet
- First gather pet details (breed, age, size, health conditions, \
preferences)
- Then fetch available foods and match them to the pet's needs
- Explain WHY you're recommending specific foods (nutritional benefits, \
breed-specific needs, etc.)
- Consider factors like: life stage, activity level, health conditions, \
dietary restrictions
- Provide 2-3 specific recommendations with clear reasoning
- Be ready to answer follow-up questions or adjust recommendations

Remember: You're having a conversation, not writing a report. Keep responses \
natural, helpful, and engaging while being informative about pet nutrition!"""

# Initialize components
app = BedrockAgentCoreApp()

conversation_manager = SummarizingConversationManager(
    summary_ratio=0.5,  # Summarize 50% of messages when context reduction \
    # is needed
    preserve_recent_messages=3,  # Always keep 3 most recent messages
)

bedrock_model = BedrockModel(
    model_id=MODEL_ID,
)

agent = Agent(
    model=bedrock_model,
    tools=[http_request],
    system_prompt=SYSTEM_PROMPT,
    conversation_manager=conversation_manager,
    callback_handler=None,
)


@app.entrypoint
async def pet_food_agent_bedrock(payload):
    """Streaming endpoint for pet food recommendation agent."""
    user_input = payload.get("prompt")
    user_id = payload.get("userId")

    if not user_input:
        yield "Error: No prompt provided in the request."
        return

    print(f"User ID: {user_id}, User input: {user_input}")

    # Add trace attributes for observability
    current_span = trace.get_current_span()
    if current_span:
        current_span.set_attribute("agent.name", "petfood-agent")
        if user_id:
            current_span.set_attribute("user.id", user_id)

    try:
        # Stream response from agent
        async for event in agent.stream_async(user_input):
            if "data" in event:
                yield event["data"]

    except Exception as e:
        error_msg = (
            f"I apologize, but I encountered an error while processing "
            f"your request: {e}"
        )
        print(f"Error in agent execution: {e}")
        yield error_msg


if __name__ == "__main__":
    app.run()
