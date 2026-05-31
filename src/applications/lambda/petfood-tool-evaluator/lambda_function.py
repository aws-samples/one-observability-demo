"""Code-based evaluator Lambda for Pet Food Agent.

Checks whether the agent correctly used the http_request tool to call
the internal search and petfood APIs. Returns PASS if both APIs were
called, FAIL otherwise.

This evaluator works at the TRACE level — it evaluates each individual
agent invocation.
"""

import json


EXPECTED_URLS = [
    "internal-LB-petsearch-java",
    "internal-LB-petfood-rs",
]


def lambda_handler(event, context):
    """Evaluate whether the agent called the correct internal APIs."""
    session_spans = event.get("evaluationInput", {}).get("sessionSpans", [])
    target_trace_ids = event.get("evaluationTarget", {}).get("traceIds", [])

    if not session_spans:
        return {
            "errorCode": "NO_SPANS",
            "errorMessage": "No session spans provided for evaluation.",
        }

    found_urls = set()

    for span in session_spans:
        if target_trace_ids and span.get("traceId") not in target_trace_ids:
            continue

        attrs = span.get("attributes", {})
        span_name = span.get("name", "")

        if "http" in span_name.lower() or attrs.get("http.url"):
            url = attrs.get("http.url", "")
            for expected in EXPECTED_URLS:
                if expected in url:
                    found_urls.add(expected)

        if attrs.get("gen_ai.operation.name") == "execute_tool":
            body = span.get("body", {})
            if isinstance(body, dict):
                tool_input = body.get("input", {})
                if isinstance(tool_input, dict):
                    url = tool_input.get("url", "")
                    for expected in EXPECTED_URLS:
                        if expected in url:
                            found_urls.add(expected)

    apis_called = len(found_urls)
    total_expected = len(EXPECTED_URLS)

    if apis_called == total_expected:
        return {
            "label": "PASS",
            "value": 1.0,
            "explanation": f"Agent called both required APIs: search and petfood.",
        }
    elif apis_called > 0:
        missing = [u for u in EXPECTED_URLS if u not in found_urls]
        return {
            "label": "PARTIAL",
            "value": 0.5,
            "explanation": f"Agent called {apis_called}/{total_expected} APIs. Missing: {', '.join(missing)}",
        }
    else:
        return {
            "label": "FAIL",
            "value": 0.0,
            "explanation": "Agent did not call any of the expected internal APIs. It may have hallucinated URLs.",
        }
