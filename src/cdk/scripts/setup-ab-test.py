#!/usr/bin/env python3
"""Setup script for AgentCore Online Evaluations + Gateway + A/B Test.

Usage:
  export DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib  # macOS only
  python3 src/cdk/scripts/setup-ab-test.py

Or from CloudShell:
  python3 setup-ab-test.py
"""

import boto3
import uuid
import time
import os

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

# Get runtime ARNs from SSM
CONTROL_ARN = ssm_client.get_parameter(Name="/petstore/petfoodagent-runtime-arn")["Parameter"]["Value"]
TREATMENT_ARN = ssm_client.get_parameter(Name="/petstore/petfoodagent-variant-b-runtime-arn")["Parameter"]["Value"]
CONTROL_ID = CONTROL_ARN.split("/")[-1]
TREATMENT_ID = TREATMENT_ARN.split("/")[-1]

print(f"Control: {CONTROL_ID}")
print(f"Treatment: {TREATMENT_ID}")

# Get eval role (paginate to find it)
EVAL_ROLE_ARN = None
paginator = iam_client.get_paginator("list_roles")
for page in paginator.paginate():
    for r in page["Roles"]:
        if "EvaluationExe" in r["RoleName"]:
            EVAL_ROLE_ARN = r["Arn"]
            break
    if EVAL_ROLE_ARN:
        break
print(f"Eval role: {EVAL_ROLE_ARN}")


# === Step 1: Online Evaluation Configs ===
print("\n=== Step 1: Online Evaluation Configs ===")

CONTROL_EVAL_ARN = None
TREATMENT_EVAL_ARN = None

# Check if configs already exist — reuse them
existing_configs = cp_client.list_online_evaluation_configs().get("onlineEvaluationConfigs", [])
for cfg in existing_configs:
    if "variant_a" in cfg["onlineEvaluationConfigName"]:
        CONTROL_EVAL_ARN = cfg["onlineEvaluationConfigArn"]
        print(f"  Reusing Variant A: {cfg['onlineEvaluationConfigId']}")
    elif "variant_b" in cfg["onlineEvaluationConfigName"]:
        TREATMENT_EVAL_ARN = cfg["onlineEvaluationConfigArn"]
        print(f"  Reusing Variant B: {cfg['onlineEvaluationConfigId']}")

# Default evaluators for fresh deployment
DEFAULT_EVALUATORS = [
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
]

if not CONTROL_EVAL_ARN:
    try:
        r = cp_client.create_online_evaluation_config(
            onlineEvaluationConfigName="petfood_variant_a_eval",
            description="Online eval for PetFoodAgent (Sonnet)",
            rule={"samplingConfig": {"samplingPercentage": 100.0}},
            dataSourceConfig={"cloudWatchLogs": {
                "logGroupNames": [f"/aws/bedrock-agentcore/runtimes/{CONTROL_ID}-DEFAULT"],
                "serviceNames": [f"{CONTROL_ID.split('-')[0]}.DEFAULT"],
            }},
            evaluators=DEFAULT_EVALUATORS,
            evaluationExecutionRoleArn=EVAL_ROLE_ARN,
            enableOnCreate=True,
        )
        CONTROL_EVAL_ARN = r["onlineEvaluationConfigArn"]
        print(f"  Created Variant A: {r['onlineEvaluationConfigId']}")
    except Exception as e:
        print(f"  Error: {e}")

if not TREATMENT_EVAL_ARN:
    try:
        r = cp_client.create_online_evaluation_config(
            onlineEvaluationConfigName="petfood_variant_b_eval",
            description="Online eval for PetFoodAgentVariantB (Haiku)",
            rule={"samplingConfig": {"samplingPercentage": 100.0}},
            dataSourceConfig={"cloudWatchLogs": {
                "logGroupNames": [f"/aws/bedrock-agentcore/runtimes/{TREATMENT_ID}-DEFAULT"],
                "serviceNames": [f"{TREATMENT_ID.split('-')[0]}.DEFAULT"],
            }},
            evaluators=DEFAULT_EVALUATORS,
            evaluationExecutionRoleArn=EVAL_ROLE_ARN,
            enableOnCreate=True,
        )
        TREATMENT_EVAL_ARN = r["onlineEvaluationConfigArn"]
        print(f"  Created Variant B: {r['onlineEvaluationConfigId']}")
    except Exception as e:
        print(f"  Error: {e}")


# === Step 2: Gateway ===
print("\n=== Step 2: Gateway ===")

GATEWAY_ROLE = "AgentCoreGatewayServiceRole"
try:
    iam_client.create_role(
        RoleName=GATEWAY_ROLE,
        AssumeRolePolicyDocument=f'{{"Version":"2012-10-17","Statement":[{{"Effect":"Allow","Principal":{{"Service":"bedrock-agentcore.amazonaws.com"}},"Action":"sts:AssumeRole","Condition":{{"StringEquals":{{"aws:SourceAccount":"{ACCOUNT_ID}"}}}}}}]}}',
    )
    print(f"  Created role: {GATEWAY_ROLE}")
except:
    print(f"  Role exists: {GATEWAY_ROLE}")

iam_client.put_role_policy(
    RoleName=GATEWAY_ROLE,
    PolicyName="GatewayPolicy",
    PolicyDocument=f'{{"Version":"2012-10-17","Statement":[{{"Effect":"Allow","Action":["bedrock-agentcore:InvokeAgentRuntime"],"Resource":["arn:aws:bedrock-agentcore:{REGION}:{ACCOUNT_ID}:runtime/*"]}},{{"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":["arn:aws:logs:{REGION}:{ACCOUNT_ID}:log-group:/aws/bedrock-agentcore/gateways/*"]}}]}}',
)

gateway_role_arn = f"arn:aws:iam::{ACCOUNT_ID}:role/{GATEWAY_ROLE}"
gateway_id = None
gateway_arn = None

try:
    gw = cp_client.create_gateway(
        name="PetFoodABGateway",
        roleArn=gateway_role_arn,
        authorizerType="AWS_IAM",
        clientToken=str(uuid.uuid4()),
    )
    gateway_id = gw["gatewayId"]
    gateway_arn = gw["gatewayArn"]
    print(f"  Gateway: {gateway_id}")
except Exception as e:
    print(f"  Gateway error: {e}")
    # Try to find existing
    try:
        gws = cp_client.list_gateways()
        for g in gws.get("gateways", []):
            if "PetFoodAB" in g["name"]:
                gateway_id = g["gatewayId"]
                gateway_arn = g["gatewayArn"]
                print(f"  Using existing: {gateway_id}")
                break
    except:
        pass

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


# === Step 3: Targets ===
print("\n=== Step 3: Targets ===")

if gateway_id:
    try:
        cp_client.create_gateway_target(
            gatewayIdentifier=gateway_id,
            name="petfood-control",
            description="Control - Sonnet",
            targetConfiguration={"http": {"agentcoreRuntime": {"arn": CONTROL_ARN, "qualifier": "DEFAULT"}}},
            credentialProviderConfigurations=[{"credentialProviderType": "GATEWAY_IAM_ROLE"}],
            clientToken=str(uuid.uuid4()),
        )
        print("  Added: petfood-control")
    except Exception as e:
        print(f"  Control: {e}")

    try:
        cp_client.create_gateway_target(
            gatewayIdentifier=gateway_id,
            name="petfood-treatment",
            description="Treatment - Haiku",
            targetConfiguration={"http": {"agentcoreRuntime": {"arn": TREATMENT_ARN, "qualifier": "DEFAULT"}}},
            credentialProviderConfigurations=[{"credentialProviderType": "GATEWAY_IAM_ROLE"}],
            clientToken=str(uuid.uuid4()),
        )
        print("  Added: petfood-treatment")
    except Exception as e:
        print(f"  Treatment: {e}")


# === Step 4: A/B Test ===
print("\n=== Step 4: A/B Test ===")

if gateway_id and CONTROL_EVAL_ARN and TREATMENT_EVAL_ARN:
    AB_ROLE = "AgentCoreABTestRole"
    try:
        iam_client.create_role(
            RoleName=AB_ROLE,
            AssumeRolePolicyDocument=f'{{"Version":"2012-10-17","Statement":[{{"Effect":"Allow","Principal":{{"Service":"bedrock-agentcore.amazonaws.com"}},"Action":"sts:AssumeRole","Condition":{{"StringEquals":{{"aws:SourceAccount":"{ACCOUNT_ID}"}},"ArnLike":{{"aws:SourceArn":"arn:aws:bedrock-agentcore:*:{ACCOUNT_ID}:ab-test/*"}}}}}}]}}',
        )
        print(f"  Created role: {AB_ROLE}")
    except:
        print(f"  Role exists: {AB_ROLE}")

    iam_client.put_role_policy(
        RoleName=AB_ROLE,
        PolicyName="ABTestPolicy",
        PolicyDocument=f'{{"Version":"2012-10-17","Statement":[{{"Effect":"Allow","Action":["bedrock-agentcore:GetGateway","bedrock-agentcore:GetGatewayTarget","bedrock-agentcore:ListGatewayTargets","bedrock-agentcore:CreateGatewayRule","bedrock-agentcore:UpdateGatewayRule","bedrock-agentcore:GetGatewayRule","bedrock-agentcore:DeleteGatewayRule","bedrock-agentcore:ListGatewayRules","bedrock-agentcore:GetOnlineEvaluationConfig","bedrock-agentcore:GetEvaluator","bedrock-agentcore:GetConfigurationBundle","bedrock-agentcore:GetConfigurationBundleVersion","bedrock-agentcore:ListConfigurationBundleVersions"],"Resource":"arn:aws:bedrock-agentcore:*:{ACCOUNT_ID}:*"}},{{"Effect":"Allow","Action":["logs:DescribeLogGroups"],"Resource":"*"}},{{"Effect":"Allow","Action":["logs:DescribeIndexPolicies","logs:PutIndexPolicy","logs:StartQuery","logs:GetQueryResults","logs:StopQuery","logs:FilterLogEvents","logs:GetLogEvents"],"Resource":["arn:aws:logs:*:{ACCOUNT_ID}:log-group:/aws/bedrock-agentcore/evaluations/*","arn:aws:logs:*:{ACCOUNT_ID}:log-group:/aws/bedrock-agentcore/runtimes/*","arn:aws:logs:*:{ACCOUNT_ID}:log-group:aws/spans","arn:aws:logs:*:{ACCOUNT_ID}:log-group:aws/spans:*"]}}]}}',
    )

    ab_test_role_arn = f"arn:aws:iam::{ACCOUNT_ID}:role/{AB_ROLE}"
    print("  Waiting for IAM propagation...")
    time.sleep(15)

    try:
        ab = dp_client.create_ab_test(
            name="petfood_sonnet_vs_haiku",
            description="80/20 A/B: Sonnet (control) vs Haiku (treatment)",
            gatewayArn=gateway_arn,
            roleArn=ab_test_role_arn,
            evaluationConfig={
                "perVariantOnlineEvaluationConfig": [
                    {"name": "C", "onlineEvaluationConfigArn": CONTROL_EVAL_ARN},
                    {"name": "T1", "onlineEvaluationConfigArn": TREATMENT_EVAL_ARN},
                ]
            },
            gatewayFilter={"targetPaths": ["/petfood-control/*"]},
            variants=[
                {"name": "C", "weight": 80, "variantConfiguration": {"target": {"name": "petfood-control"}}},
                {"name": "T1", "weight": 20, "variantConfiguration": {"target": {"name": "petfood-treatment"}}},
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
    print("  Skipped - missing gateway or eval configs")

print("\n=== Setup Complete ===")
