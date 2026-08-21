/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Auto-reload for the Waggle AI AgentCore runtimes: a new `:latest` push alone never rolls a runtime.
 *
 * @packageDocumentation
 */
import { Duration, Stack } from 'aws-cdk-lib';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Architecture, Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface WaggleAIAutoReloadProperties {
    /** Map of ECR repository name -> AgentCore runtime name (physical). */
    readonly repoToRuntime: { [repoName: string]: string };
}

// On ECR push, re-submit the runtime's current config so UpdateAgentRuntime re-pulls :latest.
const RELOAD_LAMBDA_SRC = `
import os, json, boto3

RUNTIME_MAP = json.loads(os.environ.get("RUNTIME_MAP", "{}"))
ctrl = boto3.client("bedrock-agentcore-control")

def _find_runtime_id(name):
    token = None
    while True:
        resp = ctrl.list_agent_runtimes(**({"nextToken": token} if token else {}))
        for rt in resp.get("agentRuntimes", []):
            if rt.get("agentRuntimeName") == name:
                return rt.get("agentRuntimeId")
        token = resp.get("nextToken")
        if not token:
            return None

def handler(event, _ctx):
    d = event.get("detail", {})
    if d.get("action-type") != "PUSH" or d.get("result") != "SUCCESS":
        return {"skipped": "not a successful push"}
    repo = d.get("repository-name")
    name = RUNTIME_MAP.get(repo)
    if not name:
        print("no runtime mapped for repo=%s" % repo)
        return {"skipped": repo}
    rid = _find_runtime_id(name)
    if not rid:
        print("runtime not found: %s" % name)
        return {"error": "runtime not found", "name": name}
    cur = ctrl.get_agent_runtime(agentRuntimeId=rid)
    kw = {
        "agentRuntimeId": rid,
        "agentRuntimeArtifact": cur["agentRuntimeArtifact"],
        "roleArn": cur["roleArn"],
        "networkConfiguration": cur["networkConfiguration"],
    }
    for opt in ("protocolConfiguration", "environmentVariables", "description"):
        if cur.get(opt):
            kw[opt] = cur[opt]
    ctrl.update_agent_runtime(**kw)
    print("reloaded %s (%s) after push %s:%s" % (name, rid, repo, d.get("image-tag")))
    return {"reloaded": name, "id": rid}
`;

/** EventBridge(ECR push) -> Lambda(UpdateAgentRuntime) auto-reload. */
export class WaggleAIAutoReload extends Construct {
    constructor(scope: Construct, id: string, properties: WaggleAIAutoReloadProperties) {
        super(scope, id);
        const { region, account } = Stack.of(this);
        const repos = Object.keys(properties.repoToRuntime);

        const reloadFunction = new Function(this, 'ReloadFn', {
            runtime: Runtime.PYTHON_3_13,
            architecture: Architecture.ARM_64,
            handler: 'index.handler',
            timeout: Duration.minutes(2),
            environment: { RUNTIME_MAP: JSON.stringify(properties.repoToRuntime) },
            code: Code.fromInline(RELOAD_LAMBDA_SRC),
        });

        reloadFunction.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'bedrock-agentcore:ListAgentRuntimes',
                    'bedrock-agentcore:GetAgentRuntime',
                    'bedrock-agentcore:UpdateAgentRuntime',
                ],
                resources: [`arn:aws:bedrock-agentcore:${region}:${account}:runtime/*`, '*'],
            }),
        );
        // UpdateAgentRuntime re-passes the runtime execution role to AgentCore.
        reloadFunction.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['iam:PassRole'],
                resources: [`arn:aws:iam::${account}:role/*WaggleAI*`],
                conditions: { StringEquals: { 'iam:PassedToService': 'bedrock-agentcore.amazonaws.com' } },
            }),
        );

        new Rule(this, 'EcrPushRule', {
            description: 'Reload Waggle AI agent runtimes when a new :latest image is pushed',
            eventPattern: {
                source: ['aws.ecr'],
                detailType: ['ECR Image Action'],
                detail: {
                    'action-type': ['PUSH'],
                    result: ['SUCCESS'],
                    'image-tag': ['latest'],
                    'repository-name': repos,
                },
            },
            targets: [new LambdaFunction(reloadFunction)],
        });

        NagSuppressions.addResourceSuppressions(
            reloadFunction,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Basic Lambda execution role is acceptable for the reload function',
                },
                { id: 'AwsSolutions-IAM5', reason: 'Reload Lambda lists/gets/updates the Waggle AI agent runtimes' },
            ],
            true,
        );
    }
}
