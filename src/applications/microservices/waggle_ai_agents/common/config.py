"""Central configuration for the Waggle AI agents."""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    # Explicit path: load_dotenv() searches cwd upward, never into subdirs. override=True: .env wins for dev.
    _ENV_PATH = Path(__file__).resolve().parent.parent / ".env"  # waggle_ai_agents/.env
    load_dotenv(dotenv_path=_ENV_PATH, override=True)
except ImportError:  # dotenv is optional; env vars still work without it
    pass


AWS_REGION: str = os.getenv("AWS_REGION", "us-east-1")

# Bedrock auth is the standard AWS credential chain via SigV4 — no API keys. Clients need the region.
os.environ.setdefault("AWS_DEFAULT_REGION", AWS_REGION)
os.environ.setdefault("AWS_REGION_NAME", AWS_REGION)  # LiteLLM's bedrock provider

# --- Models: ids must be ENABLED in your Bedrock account/region; per-agent mapping in models.py.
CLAUDE_MODEL_ID: str = os.getenv(
    "BEDROCK_CLAUDE_MODEL_ID",
    "us.anthropic.claude-sonnet-5",
)
# gpt-oss powers the OpenAI Agents SDK concierge (via LiteLLM's Bedrock provider).
GPT_OSS_MODEL_ID: str = os.getenv("BEDROCK_GPT_OSS_MODEL_ID", "openai.gpt-oss-120b-1:0")

# --- Backend base URLs, resolved in order: env override -> SSM (PARAMETER_STORE_PREFIX) -> "".
import functools  # noqa: E402

PARAMETER_STORE_PREFIX: str = os.getenv("PARAMETER_STORE_PREFIX", "/petstore")

# logical key -> SSM parameter short name (under the prefix)
_BACKEND_SSM_NAMES: dict[str, str] = {
    "SEARCH_API_URL": "searchapiurl",
    "PETFOOD_API_URL": "petfoodapiurl",  # foods catalog
    "PETFOOD_CART_URL": "petfoodcarturl",  # cart / checkout
    "ADOPTIONLIST_API_URL": "petlistadoptionsurl",
    "PAYFORADOPTION_API_URL": "paymentapiurl",
}


@functools.cache
def _ssm_value(short_name: str) -> str:
    """Fetch {PREFIX}/{short_name} from SSM; return '' on any failure."""
    try:
        import boto3

        ssm = boto3.client("ssm", region_name=AWS_REGION)
        resp = ssm.get_parameter(Name=f"{PARAMETER_STORE_PREFIX}/{short_name}")
        return resp["Parameter"]["Value"].rstrip("/")
    except (
        Exception
    ):  # noqa: BLE001 - missing param / no creds -> tools report "not configured"
        return ""


def _origin(url: str) -> str:
    """Reduce a URL to its scheme://host origin."""
    if not url:
        return ""
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    if parts.scheme and parts.netloc:
        return f"{parts.scheme}://{parts.netloc}"
    return url.rstrip("/")


@functools.cache
def backend_url(key: str) -> str:
    """Resolve a backend base (origin) URL: env override wins, else SSM, else ''."""
    override = os.getenv(key, "")
    return (
        _origin(override) if override else _origin(_ssm_value(_BACKEND_SSM_NAMES[key]))
    )


@functools.cache
def nutrition_kb_id() -> str:
    """Bedrock Knowledge Base id for the nutrition RAG: env override, else SSM, else ''."""
    return os.getenv("NUTRITION_KB_ID", "") or _ssm_value("waggleai/nutritionkbid")


@functools.cache
def gateway_url() -> str:
    """AgentCore Gateway base URL for delegation: env override, else SSM, else ''."""
    return os.getenv("GATEWAY_URL", "").rstrip("/") or _ssm_value("waggleai/gatewayurl")


@functools.cache
def images_cdn_url() -> str:
    """CloudFront base URL for pet/food images: env override, else SSM, else ''."""
    return os.getenv("IMAGES_CDN_URL", "").rstrip("/") or _ssm_value("imagescdnurl")


@functools.cache
def memory_id() -> str:
    """AgentCore Memory id: env override, else SSM, else '' (memory is best-effort no-op)."""
    return os.getenv("MEMORY_ID", "") or _ssm_value("waggleai/memoryid")


@functools.cache
def guardrail_id() -> str:
    """Bedrock Guardrail id: env override, else SSM, else '' (no guardrail applied)."""
    return os.getenv("GUARDRAIL_ID", "") or _ssm_value("waggleai/guardrailid")


@functools.cache
def guardrail_version() -> str:
    """Bedrock Guardrail version: env override, else SSM, else 'DRAFT'."""
    return (
        os.getenv("GUARDRAIL_VERSION", "")
        or _ssm_value("waggleai/guardrailversion")
        or "DRAFT"
    )


HTTP_TIMEOUT: float = float(os.getenv("HTTP_TIMEOUT", "15"))
