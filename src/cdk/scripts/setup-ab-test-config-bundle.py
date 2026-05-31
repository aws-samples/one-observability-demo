#!/usr/bin/env python3
"""Setup A/B test using configuration bundles (single runtime, different configs).

This creates:
- Two configuration bundles (control: Sonnet + detailed prompt, treatment: Haiku + concise prompt)
- A/B test with 80/20 traffic split using config bundles on the existing gateway

Requires: setup-ab-test.py to have been run first (gateway must exist).

Usage:
  export DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib  # macOS only
  AWS_PROFILE=default AWS_REGION=us-east-1 python3 src/cdk/scripts/setup-ab-test-config-bundle.py
"""

import boto3
import json
import os
import time
import uuid

REGION = os.environ.get("AWS_REGION", "us-east-1")
PROFILE = os.environ.get("AWS_PROFILE", "default")

session = boto3.Session(profile_name=PROFILE, region_name=REGION)
cp_client = session.client("bedrock-agentcore-control")
dp_client = session.client("bedrock-agentcore")
iam_client = session.client("iam")
ssm_client = session.client("ssm")
sts_client = session.client("sts")

ACCOUNT_ID = sts_client.get_caller_identity()["Account"]
print(f"Account: {ACCOUNT_ID}, Region: {REGION}")

# Get runtime ARN (using the control/primary agent)
RUNTIME_ARN = ssm_client.get_parameter(Name="/petstore/petfoodagent-runtime-arn")["Parameter"]["Value"]
RUNTIME_ID = RUNTIME_ARN.split("/")[-1]
print(f"Runtime: {RUNTIME_ID}")

# Get API URLs for prompts
search_api_url = ssm_client.get_parameter(Name="/petstore/searchapiurl")["Parameter"]["Value"]
petfood_api_url = ssm_client.get_parameter(Name="/petstore/petfoodapiurl")["Parameter"]["Value"]

# === Step 1: Create Configuration Bundles ===
print("\n=== Step 1: Configuration Bundles ===")

CONTROL_PROMPT = f"""You are Waggle, a friendly and knowledgeable pet food \
recommendation assistant. You're here to help pet parents find the perfect food \
for their furry, feathered, or scaled companions!

Your process:
1. First get pet details from {search_api_url}
2. Then get available foods from {petfood_api_url}
3. Match pet characteristics (age, size, breed, health conditions) with appropriate food types
4. Consider nutritional needs, dietary restrictions, and preferences
5. Provide clear reasoning for each recommendation

When helping users:
- Be conversational and friendly, not formal or robotic
- Ask clarifying questions if you need more information about their pet
- Explain WHY you're recommending specific foods
- Provide 2-3 specific recommendations with clear reasoning

Remember: You're having a conversation, not writing a report."""

TREATMENT_PROMPT = f"""You are Waggle, a pet food assistant. Be brief and direct.

Process:
1. Get pet details from {search_api_url}
2. Get available foods from {petfood_api_url}
3. Recommend 2-3 foods with one-line reasons

Keep responses under 200 words. No emojis. Focus on nutritional facts only."""

control_bundle_arn = None
control_version = None
treatment_bundle_arn = None
treatment_version = None

try:
    r = cp_client.create_configuration_bundle(
        bundleName="petfood_control_config",
        components={
            RUNTIME_ARN: {
                "configuration": {
                    "system_prompt": CONTROL_PROMPT,
                    "model_id": "us.anthropic.claude-sonnet-4-6",
                }
            }
        },
        description="Control: Sonnet + detailed conversational prompt",
        commitMessage="Initial control configuration",
        clientToken=str(uuid.uuid4()),
    )
    control_bundle_arn = r["bundleArn"]
    control_version = r["versionId"]
    print(f"  Control bundle: {r['bundleId']}")
    print(f"  Version: {control_version}")
except Exception as e:
    if "already exists" in str(e).lower() or "Conflict" in str(type(e).__name__):
        # Find existing
        bundles = cp_client.list_configuration_bundles()
        for b in bundles.get("configurationBundles", []):
            if "control" in b.get("bundleName", ""):
                control_bundle_arn = b["bundleArn"]
                detail = cp_client.get_configuration_bundle(bundleId=b["bundleId"])
                control_version = detail["versionId"]
                print(f"  Reusing control: {b['bundleId']} (v: {control_version})")
                break
    else:
        print(f"  Control error: {e}")

try:
    r = cp_client.create_configuration_bundle(
        bundleName="petfood_treatment_config",
        components={
            RUNTIME_ARN: {
                "configuration": {
                    "system_prompt": TREATMENT_PROMPT,
                    "model_id": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
                }
            }
        },
        description="Treatment: Haiku + concise directive prompt",
        commitMessage="Initial treatment configuration",
        clientToken=str(uuid.uuid4()),
    )
    treatment_bundle_arn = r["bundleArn"]
    treatment_version = r["versionId"]
    print(f"  Treatment bundle: {r['bundleId']}")
    print(f"  Version: {treatment_version}")
except Exception as e:
    if "already exists" in str(e).lower() or "Conflict" in str(type(e).__name__):
        bundles = cp_client.list_configuration_bundles()
        for b in bundles.get("configurationBundles", []):
            if "treatment" in b.get("bundleName", ""):
                treatment_bundle_arn = b["bundleArn"]
                detail = cp_client.get_configuration_bundle(bundleId=b["bundleId"])
                treatment_version = detail["versionId"]
                print(f"  Reusing treatment: {b['bundleId']} (v: {treatment_version})")
                break
    else:
        print(f"  Treatment error: {e}")

# === Step 2: Create new gateway for config bundle A/B test ===
print("\n=== Step 2: Gateway ===")

GATEWAY_ROLE = "AgentCoreGatewayServiceRole"
gateway_role_arn = f"arn:aws:iam::{ACCOUNT_ID}:role/{GATEWAY_ROLE}"
gateway_arn = None
gateway_id = None

try:
    gw = cp_client.create_gateway(
        name="PetFoodConfigBundleGateway",
        roleArn=gateway_role_arn,
        authorizerType="AWS_IAM",
        clientToken=str(uuid.uuid4()),
    )
    gateway_id = gw["gatewayId"]
    gateway_arn = gw["gatewayArn"]
    print(f"  Created: {gateway_id}")
except Exception as e:
    if "already exists" in str(e).lower() or "Conflict" in str(type(e).__name__):
        gateways = cp_client.list_gateways()
        for g in gateways.get("gateways", []):
            if "ConfigBundle" in g["name"]:
                gateway_id = g["gatewayId"]
                gateway_arn = g["gatewayArn"]
                print(f"  Reusing: {gateway_id}")
                break
    else:
        print(f"  Error: {e}")

if gateway_id:
    print("  Waiting for gateway...")
    for _ in range(30):
        g = cp_client.get_gateway(gatewayIdentifier=gateway_id)
        if g["status"] == "READY":
            break
        time.sleep(10)
    print(f"  Status: {g['status']}")

    # Enable log delivery
    try:
        cp_client.update_gateway(
            gatewayIdentifier=gateway_id,
            logDelivery={
                "cloudWatchLogDelivery": {
                    "logGroupName": f"/aws/bedrock-agentcore/gateways/{gateway_id}",
                    "enabled": True,
                }
            },
        )
        print("  Log delivery enabled")
    except Exception as e:
        print(f"  Log delivery: {e}")

    # Add the control runtime as the single target
    try:
        cp_client.create_gateway_target(
            gatewayIdentifier=gateway_id,
            name="petfood-agent",
            description="PetFoodAgent (single runtime for config bundle A/B)",
            targetConfiguration={"http": {"agentcoreRuntime": {"arn": RUNTIME_ARN, "qualifier": "DEFAULT"}}},
            credentialProviderConfigurations=[{"credentialProviderType": "GATEWAY_IAM_ROLE"}],
            clientToken=str(uuid.uuid4()),
        )
        print("  Added target: petfood-agent")
    except Exception as e:
        if "already exists" in str(e).lower() or "Conflict" in str(type(e).__name__):
            print("  Target exists: petfood-agent")
        else:
            print(f"  Target error: {e}")

# === Step 2b: Online Eval Config for Config Bundle A/B Test ===
print("\n=== Step 2b: Online Eval Config ===")

eval_config_arn = None
EVAL_CONFIG_NAME = "petfood_config_bundle_eval"

# Check if already exists
configs = cp_client.list_online_evaluation_configs().get("onlineEvaluationConfigs", [])
for c in configs:
    if c["onlineEvaluationConfigName"] == EVAL_CONFIG_NAME:
        eval_config_arn = c["onlineEvaluationConfigArn"]
        print(f"  Reusing: {c['onlineEvaluationConfigId']}")
        break

if not eval_config_arn:
    # Get eval role (paginate to find it)
    eval_role_arn = None
    paginator = iam_client.get_paginator("list_roles")
    for page in paginator.paginate():
        for r in page["Roles"]:
            if "EvaluationExe" in r["RoleName"]:
                eval_role_arn = r["Arn"]
                break
        if eval_role_arn:
            break

    if eval_role_arn:
        try:
            r = cp_client.create_online_evaluation_config(
                onlineEvaluationConfigName=EVAL_CONFIG_NAME,
                description="Online eval for config bundle A/B test (PetFoodAgent runtime)",
                rule={
                    "samplingConfig": {"samplingPercentage": 100.0},
                    "sessionConfig": {"sessionTimeoutMinutes": 5},
                },
                dataSourceConfig={"cloudWatchLogs": {
                    "logGroupNames": [f"/aws/bedrock-agentcore/runtimes/{RUNTIME_ID}-DEFAULT"],
                    "serviceNames": ["PetFoodAgent.DEFAULT"],
                }},
                evaluators=[
                    {"evaluatorId": "Builtin.Coherence"},
                    {"evaluatorId": "Builtin.Conciseness"},
                    {"evaluatorId": "Builtin.Correctness"},
                    {"evaluatorId": "Builtin.Faithfulness"},
                    {"evaluatorId": "Builtin.GoalSuccessRate"},
                    {"evaluatorId": "Builtin.InstructionFollowing"},
                    {"evaluatorId": "Builtin.Refusal"},
                    {"evaluatorId": "Builtin.ResponseRelevance"},
                    {"evaluatorId": "Builtin.ToolParameterAccuracy"},
                    {"evaluatorId": "Builtin.ToolSelectionAccuracy"},
                ],
                evaluationExecutionRoleArn=eval_role_arn,
                enableOnCreate=True,
            )
            eval_config_arn = r["onlineEvaluationConfigArn"]
            print(f"  Created: {r['onlineEvaluationConfigId']}")
        except Exception as e:
            print(f"  Error: {e}")
    else:
        print("  ERROR: No evaluation execution role found")

# === Step 3: Create A/B Test ===
print("\n=== Step 3: Config Bundle A/B Test ===")

if gateway_arn and control_bundle_arn and treatment_bundle_arn and eval_config_arn:
    # Reuse existing AB test role
    ab_test_role_arn = f"arn:aws:iam::{ACCOUNT_ID}:role/AgentCoreABTestRole"

    try:
        ab = dp_client.create_ab_test(
            name="petfood_cb_ab_test",
            description="Config bundle A/B: Sonnet+detailed (control) vs Haiku+concise (treatment)",
            gatewayArn=gateway_arn,
            roleArn=ab_test_role_arn,
            evaluationConfig={
                "onlineEvaluationConfigArn": eval_config_arn,
            },
            variants=[
                {
                    "name": "C",
                    "weight": 80,
                    "variantConfiguration": {
                        "configurationBundle": {
                            "bundleArn": control_bundle_arn,
                            "bundleVersion": control_version,
                        }
                    },
                },
                {
                    "name": "T1",
                    "weight": 20,
                    "variantConfiguration": {
                        "configurationBundle": {
                            "bundleArn": treatment_bundle_arn,
                            "bundleVersion": treatment_version,
                        }
                    },
                },
            ],
            enableOnCreate=True,
            clientToken=str(uuid.uuid4()),
        )
        print(f"  A/B test: {ab['abTestId']}")
        print(f"  Status: {ab['status']}")
        print(f"  Execution: {ab['executionStatus']}")
    except Exception as e:
        print(f"  A/B test error: {e}")
else:
    missing = []
    if not gateway_arn:
        missing.append("gateway")
    if not control_bundle_arn:
        missing.append("control bundle")
    if not treatment_bundle_arn:
        missing.append("treatment bundle")
    if not eval_config_arn:
        missing.append("eval config")
    print(f"  Skipped — missing: {', '.join(missing)}")

print("\n=== Done ===")
print("Note: The agent must be redeployed with the BeforeModelCallEvent hook")
print("to read config bundles at runtime. See agent.py changes.")
