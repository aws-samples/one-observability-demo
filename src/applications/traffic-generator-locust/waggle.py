"""
Waggle AI conversation and reply checks for the Locust generator.

One conversation runs at a time, the way a real user chats: the same session id is reused so
AgentCore Memory carries context between turns, and each turn targets the next agent in the
rotation (nutrition -> ordering -> adoption -> concierge -> guardrail -> off_topic). After SESSION_TURNS
turns a new conversation starts with a new user and session.

The PetSite streams replies and writes failures into a 200 response, so HTTP status alone says
nothing. Each reply is checked twice:
  - transport: the reply must exist and must not be one of the PetSite's error messages
  - expectation: the reply must look like the agent did its job (for example, nutrition names a
    real catalog food and ordering confirms an order without reporting a checkout problem)
"""

import json
import os
import random
import re

PROMPTS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "waggle_prompts.json")))
ROTATION = PROMPTS["rotation"]
SESSION_TURNS = int(os.environ.get("WAGGLE_SESSION_TURNS", str(2 * len(ROTATION))))

# Messages WaggleController.cs writes into the stream when something fails
PETSITE_ERRORS = (
    "Agent configuration is missing",
    "No response received from agent",
    "Sorry, I couldn't generate a response",
    "The service is currently busy",
    "the connection was interrupted",
)

# Guardrail blockedInputMessaging / blockedOutputsMessaging (waggle-ai-agents-guardrail.ts)
REFUSALS = ("I can only help with pet care, food, and adoption questions", "let's keep it about your pet")

# Mirrors src/cdk/scripts/petfood-seed.json
FOOD_NAMES = (
    "Fresh Veggie Mix", "Beef and Turkey Kibbles", "Carrot and Herb Crunchies", "Catnip Kitten Treats",
    "Raw Chicken Bites", "Salmon and Tuna Delight", "Puppy Training Treats", "Timothy Hay Pellets",
    "Kitten Growth Formula",
)

_ORDER_PROBLEM = re.compile(r"\b(snag|issue|problem|error|unable|couldn't|could not|failed|fail|404|500)\b", re.I)
_ORDER_DONE = re.compile(r"\b(order|ordered|checked out|checkout|purchase|placed|confirmation)\b", re.I)
_PET_ID = re.compile(r"\b0[0-2]\d\b")


def transport_error(reply):
    """Why the reply counts as a failed request, or None."""
    if not reply.strip():
        return "empty reply"
    for marker in PETSITE_ERRORS:
        if marker.lower() in reply.lower():
            return f"petsite error: {marker}"
    return None


def expectation_error(agent, reply):
    """Why the reply doesn't show the agent doing its job, or None."""
    refused = any(r.lower() in reply.lower() for r in REFUSALS)
    recommends_food = any(name.lower() in reply.lower() for name in FOOD_NAMES)
    if agent == "guardrail":
        return None if refused else "expected a guardrail refusal"
    if agent == "off_topic":
        # A decline may come from the guardrail or the orchestrator; it must not sell catalog products
        return "recommended catalog food for an off-topic request" if recommends_food else None
    if refused:
        return "unexpected guardrail refusal"
    if agent == "nutrition":
        return None if recommends_food else "no catalog food recommended"
    if agent == "ordering":
        if _ORDER_PROBLEM.search(reply):
            return "order reported a problem"
        return None if _ORDER_DONE.search(reply) else "no order confirmation"
    if agent == "adoption":
        return None if _PET_ID.search(reply) or "adopt" in reply.lower() else "no adoptable pets listed"
    if agent == "concierge":
        return None if len(reply.strip()) >= 150 else "reply too short for a care question"
    return None


class Conversation:
    """The single ongoing chat. A failed turn is retried with the same agent next time."""

    def __init__(self):
        self.busy = False  # one turn at a time keeps the turns in order
        self._start()

    def _start(self):
        self.user_id = f"user{random.randint(1, 99999):05d}"
        self.session_id = ""
        self.turn = 0

    def next_turn(self):
        if self.turn >= SESSION_TURNS:
            self._start()
        agent = ROTATION[self.turn % len(ROTATION)]
        return agent, random.choice(PROMPTS["prompts"][agent])

    def advance(self, session_id):
        self.session_id = session_id or self.session_id
        self.turn += 1
