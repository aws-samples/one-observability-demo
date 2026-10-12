# Traffic generator (Locust)

Generates continuous synthetic traffic against the PetSite. It runs headless as a single ECS Fargate task (`traffic-generator-locust`) in the workshop's ECS cluster.

## What it does

Each simulated user keeps one `userId` and repeats weighted journeys with 3–10 seconds of think time:

| Journey | Weight | Requests |
|---|---|---|
| browse | 6 | home page |
| search | 8 | search by pet type and color |
| search-by-color | 2 | search by color across all pet types |
| search-by-pet-id | 2 | look up one pet by its id |
| adopt | 2 | search → adoption page → `TakeMeHome` → `MakePayment` |
| adoption-list | 2 | adoption list (petlistadoption-py) |
| buy-food | 3 | food page → add to cart → cart count → checkout page → pay and check out |
| abandon-cart | 1 | add to cart → remove item → clear cart |
| invalid-requests | 1 | deliberate errors: pet type `lizard`, food id `456` |
| waggle-chat | 1 | Waggle AI chat, rate limited by `WAGGLE_CHATS_PER_HOUR` because it invokes Bedrock models |

Pets and foods come from the seed data (`src/cdk/scripts/seed.json`, `petfood-seed.json`). Keep the catalog in `locustfile.py` in sync with it.

Every journey is a root OpenTelemetry span. Outgoing requests propagate W3C and X-Ray trace context, so traces start at the simulated user. Spans are exported over OTLP/HTTP to the CloudWatch agent sidecar, which forwards them to X-Ray.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LOCUST_USERS` | `10` | Concurrent simulated users |
| `LOCUST_SPAWN_RATE` | `1` | Users started per second |
| `WAGGLE_CHATS_PER_HOUR` | `4` | Waggle chats per hour across all users; `0` disables them |
| `PETSITE_URL` | — | PetSite base URL; overrides the SSM lookup |
| `PETSITE_URL_PARAMETER_NAME` | — | SSM parameter that holds the PetSite URL |

In the CDK app, `CONCURRENT_USERS` sets `LOCUST_USERS`. Set it to `0` to run no tasks.

## Run locally

```bash
pip install -r requirements.txt
PETSITE_URL=https://<petsite-domain> OTEL_TRACES_EXPORTER=none \
  locust -f locustfile.py --headless --users 2 --spawn-rate 1 --run-time 2m
```

Omit `--headless` to use Locust's web UI on http://localhost:8089.
