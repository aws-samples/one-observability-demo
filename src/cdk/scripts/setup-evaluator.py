#!/usr/bin/env python3
"""Deploy the code-based Lambda evaluator and register it with AgentCore.

This script is idempotent — safe to re-run. It will skip resources that already exist.

Usage:
  export DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib  # macOS only
  AWS_PROFILE=default AWS_REGION=us-east-1 python3 src/cdk/scripts/setup-evaluator.py

Or from CloudShell:
  python3 setup-evaluator.py
"""

import boto3
import json
import os
import time
import uuid
import zipfile
import tempfile

REGION = os.environ.get("AWS_REGION", "us-east-1")
PROFILE = os.environ.get("AWS_PROFILE", "default")
LAMBDA_NAME = "petfood-tool-evaluator"
EVALUATOR_NAME = "PetFoodToolUsage"

session = boto3.Session(profile_name=PROFILE, region_name=REGION)
lambda_client = session.client("lambda")
iam_client = session.client("iam")
cp_client = session.client("bedrock-agentcore-control")
sts_client = session.client("sts")

ACCOUNT_ID = sts_client.get_caller_identity()["Account"]
print(f"Account: {ACCOUNT_ID}, Region: {REGION}")

# === Step 1: Create Lambda execution role ===
print("\n=== Step 1: Lambda execution role ===")
LAMBDA_ROLE = "PetFoodToolEvaluatorRole"
lambda_role_arn = f"arn:aws:iam::{ACCOUNT_ID}:role/{LAMBDA_ROLE}"

try:
    iam_client.create_role(
        RoleName=LAMBDA_ROLE,
        AssumeRolePolicyDocument=json.dumps({
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole",
            }]
        }),
    )
    iam_client.attach_role_policy(
        RoleName=LAMBDA_ROLE,
        PolicyArn="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    )
    print(f"  Created: {LAMBDA_ROLE}")
    time.sleep(10)  # Wait for role propagation
except iam_client.exceptions.EntityAlreadyExistsException:
    print(f"  Exists: {LAMBDA_ROLE}")

# === Step 2: Deploy Lambda function ===
print("\n=== Step 2: Lambda function ===")

# Find the Lambda code
script_dir = os.path.dirname(os.path.abspath(__file__))
lambda_code_path = os.path.join(script_dir, "..", "..", "applications", "lambda", "petfood-tool-evaluator", "lambda_function.py")

if not os.path.exists(lambda_code_path):
    # Try relative to cwd
    lambda_code_path = os.path.join("src", "applications", "lambda", "petfood-tool-evaluator", "lambda_function.py")

if not os.path.exists(lambda_code_path):
    print(f"  ERROR: Cannot find lambda_function.py")
    exit(1)

# Create zip
with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
    zip_path = tmp.name
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(lambda_code_path, "lambda_function.py")

with open(zip_path, "rb") as f:
    zip_bytes = f.read()

try:
    lambda_client.create_function(
        FunctionName=LAMBDA_NAME,
        Runtime="python3.13",
        Role=lambda_role_arn,
        Handler="lambda_function.lambda_handler",
        Code={"ZipFile": zip_bytes},
        Timeout=60,
        MemorySize=128,
        Description="Code-based evaluator: checks if agent called correct internal APIs",
    )
    print(f"  Created: {LAMBDA_NAME}")
except lambda_client.exceptions.ResourceConflictException:
    # Update existing
    lambda_client.update_function_code(
        FunctionName=LAMBDA_NAME,
        ZipFile=zip_bytes,
    )
    print(f"  Updated: {LAMBDA_NAME}")

os.unlink(zip_path)

LAMBDA_ARN = f"arn:aws:lambda:{REGION}:{ACCOUNT_ID}:function:{LAMBDA_NAME}"

# === Step 3: Grant AgentCore permission to invoke Lambda ===
print("\n=== Step 3: Lambda invoke permission ===")
try:
    lambda_client.add_permission(
        FunctionName=LAMBDA_NAME,
        StatementId="AgentCoreEvalInvoke",
        Action="lambda:InvokeFunction",
        Principal="bedrock-agentcore.amazonaws.com",
        SourceAccount=ACCOUNT_ID,
    )
    print("  Added invoke permission")
except lambda_client.exceptions.ResourceConflictException:
    print("  Permission exists")

# === Step 4: Register as code-based evaluator ===
print("\n=== Step 4: Register evaluator ===")
try:
    r = cp_client.create_evaluator(
        evaluatorName=EVALUATOR_NAME,
        level="TRACE",
        evaluatorConfig={
            "codeBased": {
                "lambdaConfig": {
                    "lambdaArn": LAMBDA_ARN,
                    "lambdaTimeoutInSeconds": 60,
                }
            }
        },
        description="Checks if agent called the correct internal search and petfood APIs",
    )
    evaluator_id = r["evaluatorId"]
    print(f"  Created evaluator: {evaluator_id}")
except Exception as e:
    if "ConflictException" in str(type(e)) or "already exists" in str(e):
        # Find existing
        evaluators = cp_client.list_evaluators()
        for ev in evaluators.get("evaluators", []):
            if EVALUATOR_NAME in ev.get("evaluatorName", ""):
                evaluator_id = ev["evaluatorId"]
                break
        print(f"  Exists: {evaluator_id}")
    else:
        print(f"  Error: {e}")
        evaluator_id = None

if evaluator_id:
    print(f"\n=== Done ===")
    print(f"  Evaluator ID: {evaluator_id}")
    print(f"  Lambda ARN: {LAMBDA_ARN}")
    print(f"\n  To add to an online eval config, include this evaluator ID")
    print(f"  alongside the built-in evaluators when creating the config.")
    print(f"  Note: Code-based evaluators work with online/on-demand eval,")
    print(f"  but NOT with A/B tests.")
