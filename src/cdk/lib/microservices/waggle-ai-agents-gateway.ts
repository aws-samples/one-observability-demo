/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * One AgentCore Gateway fronting the Waggle AI agent runtimes as HTTP targets.
 *
 * @packageDocumentation
 */
import { CfnOutput, CfnResource, Stack } from 'aws-cdk-lib';
import { CfnPolicyEngine } from 'aws-cdk-lib/aws-bedrockagentcore';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { Utilities } from '../utils/utilities';

/** One agent runtime exposed as a Gateway HTTP target. */
export interface AgentGatewayTarget {
    /** Target name — becomes the path segment: `{gatewayUrl}/{targetName}/invocations`. */
    readonly targetName: string;
    /** The agent's AgentCore runtime ARN. */
    readonly runtimeArn: string;
}

export interface WaggleAIGatewayProperties {
    readonly targets: AgentGatewayTarget[];
    /** SSM parameter (short name under PARAMETER_STORE_PREFIX) to publish the gateway URL. */
    readonly ssmGatewayUrlParameterName: string;
}

/** AgentCore Gateway + HTTP runtime targets for the Waggle AI agents. */
export class WaggleAIGateway extends Construct {
    public readonly gatewayUrl: string;

    constructor(scope: Construct, id: string, properties: WaggleAIGatewayProperties) {
        super(scope, id);
        const { region, account } = Stack.of(this);

        // Gateway execution role: invoke the target agent runtimes.
        const gatewayRole = new Role(this, 'GatewayRole', {
            assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        gatewayRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['bedrock-agentcore:InvokeAgentRuntime'],
                resources: [`arn:aws:bedrock-agentcore:${region}:${account}:runtime/*`],
            }),
        );

        const gateway = new CfnResource(this, 'Gateway', {
            type: 'AWS::BedrockAgentCore::Gateway',
            properties: {
                Name: 'WaggleAIGateway',
                Description: 'Ingress + agent-to-agent routing for the Waggle AI multi-agent system',
                AuthorizerType: 'AWS_IAM', // IAM (SigV4) inbound auth
                RoleArn: gatewayRole.roleArn,
                // No ProtocolType: an MCP-protocol gateway rejects HTTP `agentcoreRuntime` targets.
            },
        });

        const gatewayId = gateway.getAtt('GatewayIdentifier').toString();
        this.gatewayUrl = gateway.getAtt('GatewayUrl').toString();

        for (const t of properties.targets) {
            const target = new CfnResource(this, `Target-${t.targetName}`, {
                type: 'AWS::BedrockAgentCore::GatewayTarget',
                properties: {
                    GatewayIdentifier: gatewayId,
                    Name: t.targetName,
                    Description: `HTTP runtime target -> ${t.targetName}`,
                    CredentialProviderConfigurations: [{ CredentialProviderType: 'GATEWAY_IAM_ROLE' }],
                    // HTTP agentcoreRuntime target (raw CFN); an optional Qualifier could pin a version.
                    TargetConfiguration: { Http: { AgentcoreRuntime: { Arn: t.runtimeArn } } },
                },
            });
            target.addDependency(gateway);
        }

        // Created but not attached: ENFORCE with no authored policies would deny all traffic.
        const policyEngine = new CfnPolicyEngine(this, 'PolicyEngine', {
            name: 'WaggleAIPolicyEngine',
            description: 'AuthZ policy engine for the Waggle AI gateway (attach in ENFORCE once policies are authored)',
        });

        Utilities.createSsmParameters(
            this,
            PARAMETER_STORE_PREFIX,
            new Map([[properties.ssmGatewayUrlParameterName, this.gatewayUrl]]),
        );
        new CfnOutput(this, 'WaggleAIPolicyEngineArn', { value: policyEngine.attrPolicyEngineArn });

        new CfnOutput(this, 'WaggleAIGatewayUrl', { value: this.gatewayUrl });

        NagSuppressions.addResourceSuppressions(
            gatewayRole,
            [{ id: 'AwsSolutions-IAM5', reason: 'Gateway invokes the Waggle AI agent runtimes' }],
            true,
        );
    }
}
