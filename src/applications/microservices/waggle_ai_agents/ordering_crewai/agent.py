"""Ordering sub-agent — CrewAI crew on Bedrock Claude."""

from __future__ import annotations

import json
import threading
from collections import defaultdict

from crewai import LLM, Agent, Crew, Process, Task
from crewai.tools import tool

from waggle_ai_agents.common import models, petstore

# CrewAI runs the tool calls of one model response concurrently. Without this, "add these and
# check out" sends the adds and the checkout at the same moment, and petfood can receive the
# checkout before any item is in the cart (404 "Cart not found"). Cart operations for a user
# therefore run one at a time.
_cart_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
_cart_locks_guard = threading.Lock()


def _cart_lock(user_id: str) -> threading.Lock:
    with _cart_locks_guard:
        return _cart_locks[user_id]


@tool("list_available_foods")
def list_available_foods() -> str:
    """List every available pet food from the catalog. Each item has its `id`, name,
    price and `image_url`. ALWAYS use this first to resolve a food name OR a photo
    URL to a real `food_id` — the cart rejects unknown ids with 404. Returns JSON."""
    return json.dumps(petstore.list_foods())


@tool("add_food_to_cart")
def add_food_to_cart(user_id: str, food_id: str, quantity: int = 1) -> str:
    """Add `quantity` of a food item to `user_id`'s cart WITHOUT buying it. `food_id` MUST
    be a real id from `list_available_foods` (not a name or a guess), or the cart returns
    404. To buy foods, use `checkout_cart` with `food_ids` instead. Returns JSON."""
    with _cart_lock(user_id):
        return json.dumps(petstore.add_to_cart(user_id, food_id, quantity))


@tool("view_cart")
def view_cart(user_id: str) -> str:
    """Return the current contents of `user_id`'s cart as JSON."""
    with _cart_lock(user_id):
        return json.dumps(petstore.get_cart(user_id))


def _quantities_in_cart(cart) -> dict[str, int]:
    """food_id -> quantity already in a cart response ({} for a missing or empty cart)."""
    if not isinstance(cart, dict) or "error" in cart:
        return {}
    return {i.get("food_id"): int(i.get("quantity", 0)) for i in cart.get("items") or [] if isinstance(i, dict)}


@tool("checkout_cart")
def checkout_cart(user_id: str, food_ids: list[str] | None = None, quantity: int = 1) -> str:
    """Place the food order for `user_id`. Pass the foods to buy as `food_ids`, a list of
    food ids from `list_available_foods` (for example ["F233c473c", "F3e40f637"]). The
    order will contain `quantity` of each: foods already in the cart are counted, so
    nothing is bought twice. Then the cart is checked out, all in ONE step. With no
    `food_ids`, checks out what is already in the cart. If any food can't be added,
    nothing is checked out and the error is returned. Returns JSON."""
    food_ids = list(dict.fromkeys(f.strip() for f in (food_ids or []) if isinstance(f, str) and f.strip()))
    with _cart_lock(user_id):
        in_cart = _quantities_in_cart(petstore.get_cart(user_id))
        if not food_ids and not in_cart:
            # Not an error: steer the model to the one-step call instead of a 404 from petfood
            return json.dumps(
                {
                    "checked_out": False,
                    "reason": "The cart is empty, so nothing was ordered yet.",
                    "next_step": (
                        "Call checkout_cart again with food_ids set to the ids of the foods the "
                        "customer wants to buy. If you don't know which foods, ask the customer."
                    ),
                }
            )
        added = []
        for food_id in food_ids:
            # The model often adds a food and then also lists it here: top up instead of adding again
            missing = quantity - in_cart.get(food_id, 0)
            if missing <= 0:
                continue
            result = petstore.add_to_cart(user_id, food_id, missing)
            if isinstance(result, dict) and "error" in result:
                return json.dumps({"error": f"could not add {food_id}: {result['error']}", "added": added})
            added.append({"food_id": food_id, "quantity": missing})
        return json.dumps({"added": added, "checkout": petstore.checkout(user_id)})


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
            "the cart rejects unknown ids. To buy, you place the order with a single "
            "checkout_cart call that lists the ids of the foods to buy as food_ids; you only use "
            "add_food_to_cart when the customer wants to add without buying. "
            "If the customer refers to a food by PHOTO "
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
