/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Pre-provisions an AWS DevOps Agent space for the One Observability Workshop.
 *
 * The workshop's Application Observability module connects Omni to a DevOps Agent space
 * named `one-observability-workshop` to enable AI-powered root-cause investigations from
 * firing alerts. Workshop Studio participants previously had to create this space manually
 * in the AWS DevOps Agent console. This construct automates that step.
 *
 * Resources created:
 * - `DevOpsAgentRole-AgentSpace`     — Assumed by the DevOps Agent service. Carries
 *   `AIDevOpsAgentAccessPolicy` and an inline policy that allows the service-linked role
 *   for Resource Explorer to be created on first use.
 * - `DevOpsAgentRole-WebappAdmin`    — Operator app role used by participants to sign in
 *   to the DevOps Agent web app. Carries `AIDevOpsOperatorAppAccessPolicy`.
 * - `one-observability-workshop`     — The agent space, created with IAM auth and wired
 *   to the operator role above.
 * - AWS account association           — Registers this account as a monitored account so
 *   the agent can read telemetry from it.
 *
 * Role names are load bearing. The participant policy grants `iam:PassRole` by name,
 * and the association references the monitoring role ARN by value. Rename either and
 * the space setup or investigations break.
 *
 * @packageDocumentation
 */

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
    CfnRole,
    ManagedPolicy,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { CfnAgentSpace, CfnAssociation } from 'aws-cdk-lib/aws-devopsagent';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/** Must stay in sync with the PassRole grants in the workshop participant policy. */
const AGENT_ROLE_NAME = 'DevOpsAgentRole-AgentSpace';
const OPERATOR_ROLE_NAME = 'DevOpsAgentRole-WebappAdmin';
const SPACE_NAME = 'one-observability-workshop';

/**
 * CDK construct that pre-provisions the AWS DevOps Agent space and its IAM roles for
 * the One Observability Workshop.
 *
 * Participants still connect the space to Omni themselves (Settings → Integrations →
 * AWS DevOps Agent → Select space), so the module keeps its original hands-on shape.
 */
export class DevOpsAgentSpace extends Construct {
    /** IAM role assumed by the DevOps Agent service to monitor this account. */
    public readonly agentRole: Role;

    /** IAM role used by participants to sign in to the DevOps Agent operator app. */
    public readonly operatorRole: Role;

    /** The agent space. Its ID is available as `agentSpace.ref`. */
    public readonly agentSpace: CfnAgentSpace;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        const stack = Stack.of(this);
        const account = stack.account;

        // ── Agent access role ──────────────────────────────────────────────────────────
        // Assumed by the DevOps Agent service to investigate resources in this account.
        this.agentRole = new Role(this, 'AgentRole', {
            roleName: AGENT_ROLE_NAME,
            description:
                'Assumed by the AWS DevOps Agent service to monitor and investigate resources in the workshop account',
            assumedBy: new ServicePrincipal('aidevops.amazonaws.com', {
                conditions: { StringEquals: { 'aws:SourceAccount': account } },
            }),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AIDevOpsAgentAccessPolicy')],
            inlinePolicies: {
                // The agent creates a Resource Explorer service-linked role on first use if
                // one does not already exist. This grants the minimum permission for that.
                ResourceExplorerSLR: new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            sid: 'CreateResourceExplorerServiceLinkedRole',
                            actions: ['iam:CreateServiceLinkedRole'],
                            resources: [
                                'arn:aws:iam::*:role/aws-service-role/resource-explorer-2.amazonaws.com/*',
                            ],
                            conditions: {
                                StringLike: {
                                    'iam:AWSServiceName': 'resource-explorer-2.amazonaws.com',
                                },
                            },
                        }),
                    ],
                }),
            },
        });

        // Override CDK's default single-action trust policy with the cross-service confused
        // deputy pattern required by the DevOps Agent service.
        (this.agentRole.node.defaultChild as CfnRole).assumeRolePolicyDocument = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { Service: 'aidevops.amazonaws.com' },
                    Action: ['sts:AssumeRole', 'sts:TagSession', 'sts:SetSourceIdentity'],
                    Condition: { StringEquals: { 'aws:SourceAccount': account } },
                },
            ],
        };

        // ── Operator role ──────────────────────────────────────────────────────────────
        // Used by participants when signing in to the DevOps Agent web app.
        this.operatorRole = new Role(this, 'OperatorRole', {
            roleName: OPERATOR_ROLE_NAME,
            description: 'Operator app role for DevOps Agent — assumed by workshop participants via the web app',
            assumedBy: new ServicePrincipal('aidevops.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AIDevOpsOperatorAppAccessPolicy')],
        });

        // ── Agent space ────────────────────────────────────────────────────────────────
        this.agentSpace = new CfnAgentSpace(this, 'Space', {
            name: SPACE_NAME,
            description:
                'One Observability Workshop — pre-provisioned for Application Observability and Analytics modules',
            operatorApp: {
                iam: {
                    roleArn: this.operatorRole.roleArn,
                },
            },
        });

        // The space depends on both roles existing before it is created.
        this.agentSpace.addDependency(this.agentRole.node.defaultChild as CfnRole);
        this.agentSpace.addDependency(this.operatorRole.node.defaultChild as CfnRole);

        // ── Account association ────────────────────────────────────────────────────────
        // Registers this account as a monitored account so the agent can read its telemetry.
        const association = new CfnAssociation(this, 'AccountAssociation', {
            agentSpaceId: this.agentSpace.ref,
            associationType: 'AWS',
            monitoringRoleArn: this.agentRole.roleArn,
        });

        association.addDependency(this.agentSpace);

        // Retain roles and space on stack delete: a space that is in use keeps a reference
        // to the monitoring role, and removing the role breaks the space. Workshop account
        // teardown cleans up all resources explicitly.
        for (const resource of [this.agentRole, this.operatorRole, this.agentSpace]) {
            resource.applyRemovalPolicy(RemovalPolicy.RETAIN);
        }

        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'AWS DevOps Agent requires its managed policies on the agent access and operator roles',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'The Resource Explorer SLR grant uses a StringLike condition on the service name, which is the minimum scope the service accepts',
                },
            ],
            true,
        );
    }
}
