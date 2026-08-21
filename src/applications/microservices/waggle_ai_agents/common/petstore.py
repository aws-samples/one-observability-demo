"""Thin client over the PetStore backend microservices."""

from __future__ import annotations

import os
from typing import Any

import httpx

from waggle_ai_agents.common import config


def _get(base_url: str, name: str, path: str, params: dict | None = None) -> Any:
    if not base_url:
        return {"error": f"{name} is not configured (set its *_API_URL in .env)"}
    try:
        resp = httpx.get(
            f"{base_url}{path}",
            params=params,
            timeout=config.HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:  # noqa: BLE001 - surface any failure to the agent
        return {"error": f"{name} request failed: {exc}"}


def _post(
    base_url: str,
    name: str,
    path: str,
    params: dict | None = None,
    json_body: dict | None = None,
) -> Any:
    if not base_url:
        return {"error": f"{name} is not configured (set its *_API_URL in .env)"}
    try:
        resp = httpx.post(
            f"{base_url}{path}",
            params=params,
            json=json_body,
            timeout=config.HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        # some endpoints return empty bodies
        return resp.json() if resp.content else {"status": "ok"}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{name} request failed: {exc}"}


# Placeholder payer for demo checkouts (the cart API requires a payment method).
CHECKOUT_EMAIL = os.getenv("CHECKOUT_EMAIL", "petstore-demo@example.com")


# --- pet vocabulary: the store stocks only young animals, so these are the ONLY valid values.
PET_TYPES = ("puppy", "kitten", "bunny")
PET_COLORS = ("black", "brown", "white")
_TYPE_SYNONYMS = {
    "cat": "kitten",
    "kitty": "kitten",
    "kitten": "kitten",
    "dog": "puppy",
    "doggy": "puppy",
    "puppy": "puppy",
    "rabbit": "bunny",
    "bunny": "bunny",
    "hare": "bunny",
}


def normalize_pet_type(pettype: str | None) -> str | None:
    """Map a user term to a valid petType (puppy|kitten|bunny)."""
    if not pettype:
        return pettype
    key = pettype.strip().lower()
    return _TYPE_SYNONYMS.get(key, key)


def normalize_pet_color(petcolor: str | None) -> str | None:
    """Lowercase the color; valid values are black|brown|white."""
    return petcolor.strip().lower() if petcolor else petcolor


# --- pet-search ----------------------------------------------------------
def search_pets(
    pettype: str | None = None,
    petcolor: str | None = None,
    petid: str | None = None,
    user_id: str | None = None,
) -> Any:
    """Return pets matching the given type/color/id filters."""
    params = {
        "pettype": normalize_pet_type(pettype) or "",
        "petcolor": normalize_pet_color(petcolor) or "",
        "petid": petid or "",
        "userId": user_id or "",
    }
    return _get(
        config.backend_url("SEARCH_API_URL"),
        "pet-search",
        "/api/search",
        params,
    )


# --- petfood catalog + cart ---------------------------------------------
def _with_image_url(payload: Any) -> Any:
    """Add an absolute `image_url` to food record(s)."""
    cdn = config.images_cdn_url()

    def fix(food: Any) -> Any:
        if not isinstance(food, dict):
            return food
        image = food.get("image")
        if cdn and isinstance(image, str) and image and not image.startswith("http"):
            food["image_url"] = f"{cdn}/{image.lstrip('/')}"
        elif isinstance(image, str) and image.startswith("http"):
            food["image_url"] = image
        return food

    if isinstance(payload, list):
        return [fix(f) for f in payload]
    if isinstance(payload, dict):
        for key in ("foods", "items", "data"):  # tolerate a wrapped list
            if isinstance(payload.get(key), list):
                payload[key] = [fix(f) for f in payload[key]]
                return payload
        return fix(payload)
    return payload


def list_foods() -> Any:
    """Return the full pet-food catalog (each item gains an absolute `image_url`)."""
    return _with_image_url(
        _get(config.backend_url("PETFOOD_API_URL"), "petfood", "/api/foods"),
    )


def get_food(food_id: str) -> Any:
    """Return details for a single food item (with an absolute `image_url`)."""
    return _with_image_url(
        _get(config.backend_url("PETFOOD_API_URL"), "petfood", f"/api/foods/{food_id}"),
    )


def get_cart(user_id: str) -> Any:
    """Return the user's current cart."""
    return _get(
        config.backend_url("PETFOOD_CART_URL"),
        "petfood-cart",
        f"/api/cart/{user_id}",
    )


def add_to_cart(user_id: str, food_id: str, quantity: int = 1) -> Any:
    """Add a food item to the user's cart."""
    return _post(
        config.backend_url("PETFOOD_CART_URL"),
        "petfood-cart",
        f"/api/cart/{user_id}/items",
        json_body={"food_id": food_id, "quantity": quantity},
    )


def checkout(user_id: str, email: str | None = None) -> Any:
    """Check out the user's cart (places the food order)."""
    body = {
        "payment_method": {"PayPal": {"email": email or CHECKOUT_EMAIL}},
        "shipping_address": None,
        "billing_address": None,
    }
    return _post(
        config.backend_url("PETFOOD_CART_URL"),
        "petfood-cart",
        f"/api/cart/{user_id}/checkout",
        json_body=body,
    )


# --- adoption ------------------------------------------------------------
def list_recent_adoptions() -> Any:
    """Return recently COMPLETED adoptions (history), not pets available to adopt."""
    return _get(
        config.backend_url("ADOPTIONLIST_API_URL"),
        "petlistadoptions",
        "/api/adoptionlist/",
    )


def complete_adoption(pet_id: str, pet_type: str, user_id: str) -> Any:
    """Complete an adoption for the given pet on behalf of the user."""
    params = {
        "petId": pet_id,
        "petType": normalize_pet_type(pet_type),
        "userId": user_id,
    }
    return _post(
        config.backend_url("PAYFORADOPTION_API_URL"),
        "payforadoption",
        "/api/completeadoption",
        params=params,
    )
