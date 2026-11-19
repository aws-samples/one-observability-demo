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
| adopt | 2 | search → pick a pet the page shows as available → adoption page → `TakeMeHome` → `MakePayment`. Capped by `ADOPTIONS_PER_HOUR` |
| adoption-list | 2 | adoption list (petlistadoption-py) |
| buy-food | 3 | food page → add to cart → cart count → checkout page → pay and check out |
| abandon-cart | 1 | add to cart → remove item → clear cart |
| invalid-requests | 1 | deliberate errors: pet type `lizard`, food id `456` |
| waggle-chat | 1 | Next turn of the ongoing Waggle AI conversation (see below), rate limited by `WAGGLE_CHATS_PER_HOUR` because it invokes Bedrock models |

Pets and foods come from the seed data (`src/cdk/scripts/seed.json`, `petfood-seed.json`). Keep the catalog in `locustfile.py` in sync with it.

Every journey is a root OpenTelemetry span. Outgoing requests propagate W3C and X-Ray trace context, so traces start at the simulated user. Spans are exported over OTLP/HTTP to the CloudWatch agent sidecar, which forwards them to X-Ray.

## Waggle AI checks

Waggle traffic is one continuous conversation, as a real user would have. The session id is reused so AgentCore Memory carries context, and each turn targets the next agent in `waggle_prompts.json`: nutrition → ordering → adoption → concierge → guardrail → off_topic. Nutrition comes right before ordering, so "add that to my cart" refers to the recommendation. After `WAGGLE_SESSION_TURNS` turns (default two rotations) a new conversation starts.

The PetSite streams replies and reports failures inside a 200 response, so every reply is checked in two ways (`waggle.py`):

- **Transport:** `/Waggle/SendMessage (<agent>)` fails on an HTTP error, an empty reply, or one of the PetSite's stream error messages. A failed turn is retried with the same agent.
- **Expectation:** a separate `WAGGLE expect <agent>` stat fails when the answer doesn't show the agent doing its job:

| Agent | Passes when the reply… |
|---|---|
| nutrition | names a catalog food |
| ordering | confirms an order without reporting a checkout problem |
| adoption | lists adoptable pets |
| concierge | gives a substantive care answer |
| guardrail | is the guardrail's refusal (medication dosing is a denied topic) |
| off_topic | declines without recommending catalog products |

Each check also sets `waggle.agent` and `waggle.expectation` (`pass` or `fail`) on the journey span, and marks the span as an error on failure. Failures are logged as `waggle <agent> ... failed: <reason>`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LOCUST_USERS` | `10` | Concurrent simulated users |
| `LOCUST_SPAWN_RATE` | `1` | Users started per second |
| `WAGGLE_CHATS_PER_HOUR` | `4` | Waggle conversation turns per hour; `0` disables them |
| `WAGGLE_SESSION_TURNS` | `12` | Turns before a new Waggle conversation starts |
| `ADOPTIONS_PER_HOUR` | `40` | Adoptions per hour across all users. Each adoption keeps a pet unavailable until the housekeeping canary resets pets every 30 minutes, so keep this below the 26 seeded pets per reset cycle |
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
