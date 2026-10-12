"""
Continuous synthetic traffic for the PetSite, run headless by Locust on ECS Fargate.

Each simulated user keeps a session (one userId) and repeatedly performs weighted journeys:
browsing, searching, adopting a pet end to end, viewing the adoption list, buying pet food,
abandoning a cart and, rarely, chatting with the Waggle assistant. A small share of journeys
send deliberately invalid requests so the workshop has errors to investigate.

Every journey is a root OpenTelemetry span. Outgoing requests are instrumented and carry
W3C and X-Ray trace context, so a trace starts at the simulated user and continues through
the PetSite and its backend services. Spans are exported over OTLP to the CloudWatch agent
sidecar.
"""

# Locust patches the standard library with gevent on import. Import it before anything that
# pulls in ssl/requests, and set up OpenTelemetry only afterwards.
from locust import HttpUser, between, events, task  # isort: skip

import logging
import os
import random
import time
import uuid

import boto3
import gevent
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

logger = logging.getLogger("traffic-generator")

# Catalog mirrors src/cdk/scripts/seed.json and petfood-seed.json so journeys use pets and
# foods that exist. Keep these in sync with the seed data.
PETS = {
    "puppy": [
        ("001", "black"), ("002", "black"), ("003", "brown"), ("004", "black"), ("005", "brown"),
        ("006", "brown"), ("007", "brown"), ("008", "brown"), ("009", "black"), ("010", "brown"),
        ("011", "white"), ("012", "white"), ("013", "white"), ("014", "black"), ("015", "white"),
    ],
    "kitten": [
        ("016", "white"), ("017", "white"), ("018", "black"), ("019", "grey"), ("020", "brown"),
        ("021", "brown"), ("022", "black"),
    ],
    "bunny": [("023", "white"), ("024", "brown"), ("025", "brown"), ("026", "brown")],
}
FOODS = {
    "puppy": ["F233c473c", "F3e40f637", "Fecd30d31"],
    "kitten": ["F3585a442", "Fc7f447a1", "Ffb5ef0e2"],
    "bunny": ["F046a4eca", "F36a222eb", "F57580f2e"],
}
COLORS = ["black", "brown", "grey", "white"]
WAGGLE_PROMPTS = [
    "What food would you recommend for a new puppy?",
    "Which pets are available for adoption right now?",
    "How much should I feed a kitten each day?",
    "What do bunnies like to eat?",
]

# Waggle calls invoke Bedrock models, so they are rate limited for the whole process.
WAGGLE_CHATS_PER_HOUR = float(os.environ.get("WAGGLE_CHATS_PER_HOUR", "4"))
_next_waggle_chat = time.monotonic()


def resolve_host():
    """PetSite base URL from PETSITE_URL, or from the SSM parameter named by PETSITE_URL_PARAMETER_NAME."""
    if os.environ.get("PETSITE_URL"):
        return os.environ["PETSITE_URL"].rstrip("/")
    name = os.environ["PETSITE_URL_PARAMETER_NAME"]
    ssm = boto3.client("ssm")
    for attempt in range(30):
        try:
            return ssm.get_parameter(Name=name)["Parameter"]["Value"].rstrip("/")
        except ssm.exceptions.ParameterNotFound:
            logger.warning("SSM parameter %s not found yet (attempt %d), retrying", name, attempt + 1)
            time.sleep(10)
    raise RuntimeError(f"SSM parameter {name} not found")


def setup_tracing():
    """Traces go over OTLP/HTTP to the local agent; sampler, service name and propagators come from OTEL_* env vars."""
    provider = TracerProvider(resource=Resource.create())
    if os.environ.get("OTEL_TRACES_EXPORTER", "otlp") != "none":
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    # Don't trace the SSM/boto3 calls or the exporter's own requests
    RequestsInstrumentor().instrument(excluded_urls="amazonaws.com,localhost")
    return provider


_provider = setup_tracing()
tracer = trace.get_tracer("traffic-generator")


@events.quitting.add_listener
def _flush_spans(environment, **kwargs):
    _provider.shutdown()


@events.init.add_listener
def _log_stats_every_minute(environment, **kwargs):
    """Run with --only-summary and log one compact line per minute instead of Locust's stats table."""

    def loop():
        last_requests, last_failures = 0, 0
        while True:
            gevent.sleep(60)
            total = environment.stats.total
            logger.info(
                "last 60s: %d requests, %d failures, %d users, p95 %sms (all-time %d requests)",
                total.num_requests - last_requests,
                total.num_failures - last_failures,
                environment.runner.user_count if environment.runner else 0,
                total.get_current_response_time_percentile(0.95),
                total.num_requests,
            )
            last_requests, last_failures = total.num_requests, total.num_failures

    gevent.spawn(loop)


class PetSiteUser(HttpUser):
    host = resolve_host()
    wait_time = between(3, 10)

    def on_start(self):
        self.user_id = f"user{random.randint(30000, 40000):05d}"

    def _journey(self, name):
        return tracer.start_as_current_span(f"journey {name}", attributes={"journey.name": name})

    def _get(self, path, name, **params):
        return self.client.get(path, params={"userId": self.user_id, **params}, name=name)

    def _expect_error(self, response):
        """Deliberate bad requests: count the expected 4xx/5xx as a success in Locust's stats."""
        if response.status_code >= 400:
            response.success()

    @task(6)
    def browse(self):
        with self._journey("browse"):
            self._get("/", "/ (home)")

    @task(8)
    def search(self):
        pet_type = random.choice(list(PETS))
        color = random.choice(COLORS + ["all"])
        with self._journey("search"):
            self._get("/", "/ (search)", selectedPetType=pet_type, selectedPetColor=color)

    @task(2)
    def search_by_color(self):
        with self._journey("search-by-color"):
            self._get("/", "/ (search by color)", selectedPetType="all", selectedPetColor=random.choice(COLORS))

    @task(2)
    def search_by_pet_id(self):
        pet_id, _ = random.choice(PETS[random.choice(list(PETS))])
        with self._journey("search-by-pet-id"):
            self._get("/", "/ (search by pet id)", selectedPetType="all", selectedPetColor="all", petid=pet_id)

    @task(2)
    def adopt(self):
        pet_type = random.choice(list(PETS))
        pet_id, color = random.choice(PETS[pet_type])
        with self._journey("adopt"):
            self._get("/", "/ (search)", selectedPetType=pet_type, selectedPetColor=color)
            self._get("/Adoption", "/Adoption", petid=pet_id)
            self.client.post(
                "/Adoption/TakeMeHome",
                params={"userId": self.user_id},
                data={"pettype": pet_type, "petid": pet_id, "petcolor": color},
                name="/Adoption/TakeMeHome",
            )
            # Follows the redirect to /Payment?status=success
            self.client.post(
                "/Payment/MakePayment",
                data={"petId": pet_id, "petType": pet_type, "userId": self.user_id},
                name="/Payment/MakePayment",
            )

    @task(2)
    def adoption_list(self):
        with self._journey("adoption-list"):
            self._get("/PetListAdoptions", "/PetListAdoptions")

    @task(3)
    def buy_food(self):
        pet_type = random.choice(list(PETS))
        food_id = random.choice(FOODS[pet_type])
        with self._journey("buy-food"):
            self._get("/FoodService", "/FoodService", petType=pet_type)
            self.client.post(
                "/FoodService/AddToCart",
                data={"foodId": food_id, "userId": self.user_id},
                name="/FoodService/AddToCart",
            )
            self._get("/FoodService/GetCartCount", "/FoodService/GetCartCount")
            self._get("/Checkout", "/Checkout")
            self.client.post("/Checkout/PayAndCheckOut", json=self._checkout_payload(), name="/Checkout/PayAndCheckOut")

    @task(1)
    def abandon_cart(self):
        pet_type = random.choice(list(PETS))
        food_id = random.choice(FOODS[pet_type])
        with self._journey("abandon-cart"):
            self.client.post(
                "/FoodService/AddToCart",
                data={"foodId": food_id, "userId": self.user_id},
                name="/FoodService/AddToCart",
            )
            self.client.post(
                "/Checkout/RemoveItem",
                json={"userId": self.user_id, "food_id": food_id},
                name="/Checkout/RemoveItem",
            )
            self.client.post("/Checkout/ClearCart", data={"userId": self.user_id}, name="/Checkout/ClearCart")

    @task(1)
    def invalid_requests(self):
        with self._journey("invalid-requests"):
            with self.client.get(
                "/",
                params={"userId": self.user_id, "selectedPetType": "lizard", "selectedPetColor": "all"},
                name="/ (invalid pet type)",
                catch_response=True,
            ) as response:
                self._expect_error(response)
            with self.client.post(
                "/FoodService/AddToCart",
                data={"foodId": "456", "userId": self.user_id},
                name="/FoodService/AddToCart (invalid food)",
                catch_response=True,
            ) as response:
                self._expect_error(response)

    @task(1)
    def waggle_chat(self):
        global _next_waggle_chat
        if WAGGLE_CHATS_PER_HOUR <= 0 or time.monotonic() < _next_waggle_chat:
            return
        _next_waggle_chat = time.monotonic() + 3600 / WAGGLE_CHATS_PER_HOUR
        with self._journey("waggle-chat"):
            self._get("/Waggle", "/Waggle")
            self.client.post(
                "/Waggle/SendMessage",
                json={"message": random.choice(WAGGLE_PROMPTS), "userId": self.user_id, "sessionId": str(uuid.uuid4())},
                name="/Waggle/SendMessage",
                timeout=120,
            )

    def _checkout_payload(self):
        address = {
            "name": "Workshop User",
            "street": "410 Terry Ave N",
            "city": "Seattle",
            "state": "WA",
            "zip_code": "98109",
            "country": "USA",
        }
        return {
            "userId": self.user_id,
            "payment_method": {
                "CreditCard": {
                    "card_number": "4111111111111111",
                    "expiry_month": 12,
                    "expiry_year": 2030,
                    "cvv": "123",
                    "cardholder_name": "Workshop User",
                }
            },
            "shipping_address": address,
            "billing_address": address,
        }
