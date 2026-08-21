"""Ordering sub-agent — CrewAI crew on Bedrock Claude."""

from __future__ import annotations

import json

from crewai import LLM, Agent, Crew, Process, Task
from crewai.tools import tool

from waggle_ai_agents.common import models, petstore


@tool("list_available_foods")
def list_available_foods() -> str:
    """List every available pet food from the catalog. Each item has its `id`, name,
    price and `image_url`. ALWAYS use this first to resolve a food name OR a photo
    URL to a real `food_id` — the cart rejects unknown ids with 404. Returns JSON."""
    return json.dumps(petstore.list_foods())


@tool("add_food_to_cart")
def add_food_to_cart(user_id: str, food_id: str, quantity: int = 1) -> str:
    """Add `quantity` of a food item to `user_id`'s cart. `food_id` MUST be a real id
    from `list_available_foods` (not a name or a guess), or the cart returns 404.
    Returns JSON."""
    return json.dumps(petstore.add_to_cart(user_id, food_id, quantity))


@tool("view_cart")
def view_cart(user_id: str) -> str:
    """Return the current contents of `user_id`'s cart as JSON."""
    return json.dumps(petstore.get_cart(user_id))


@tool("checkout_cart")
def checkout_cart(user_id: str) -> str:
    """Check out `user_id`'s cart, placing the food order. Returns JSON."""
    return json.dumps(petstore.checkout(user_id))


_llm = LLM(model=models.litellm_model("ordering"))


def run(query: str, user_id: str | None = None, session_id: str | None = None) -> str:
    """Execute a food-ordering request and return plain text."""
    clerk = Agent(
        role="Pet Food Ordering Clerk",
        goal="Add the right foods to the cart and complete checkout accurately.",
        backstory=(
            "You run the PetStore food-ordering desk. You add foods to carts, "
            "review cart contents, and place orders via checkout. When a customer "
            "names a food, you FIRST call list_available_foods to find its real "
            "food_id, then add that id to the cart — you never guess an id, because "
            "the cart rejects unknown ids. If the customer refers to a food by PHOTO "
            "URL (they clicked a photo in the chat), call list_available_foods and "
            "match that URL against each item's image_url to identify the food. "
            "Checkout places a real order, so state what you are about to buy and its "
            "price, and only check out when the customer asked to buy or confirmed. "
            "When you list foods, show each one as markdown ![name](image_url) so the "
            "customer can see and click it. You always confirm what you did and "
            "surface any errors."
        ),
        llm=_llm,
        tools=[list_available_foods, add_food_to_cart, view_cart, checkout_cart],
        verbose=False,
        allow_delegation=False,
    )

    task = Task(
        description=(
            f"Customer request: {query}\n"
            f"user_id to act on: {user_id or 'UNKNOWN — ask the customer for it before any cart action'}\n"
            "Use tools to actually perform the action. Report exactly what happened."
        ),
        expected_output="A short confirmation of the ordering action taken and its result.",
        agent=clerk,
    )

    crew = Crew(agents=[clerk], tasks=[task], process=Process.sequential, verbose=False)
    return str(crew.kickoff())
