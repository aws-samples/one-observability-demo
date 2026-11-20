/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Pre-provisions the IAM roles required by AWS DevOps Agent for the One Observability Workshop.
 *
 * The DevOps Agent space creation wizard (and the CDK CfnAgentSpace resource) reference IAM roles
 * during setup. Under the workshop's hardened participant policy, `iam:CreateRole` and
 * `iam:AttachRolePolicy` are not available to participants. This construct pre-provisions both
 * roles using the elevated CodeBuild deployment role instead, following the same Option B pattern
 * used by OmniRoles.
 *
 * DevOpsAgentSpace (the sibling construct) looks these roles up by name rather than creating them,
 * so the two constructs compose cleanly and neither needs elevated IAM write permissions after
 * the roles exist.
 *
 * Role names are load bearing. The participant policy grants `iam:PassRole` by exact name, and
 * the CfnAssociation references the monitoring role ARN by value. Renaming either breaks space
 * setup or investigations.
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
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/** Must stay in sync with the PassRole grants in the workshop participant policy. */
export const DEVOPS_AGENT_ROLE_NAME = 'DevOpsAgentRole-AgentSpace';
export const DEVOPS_AGENT_OPERATOR_ROLE_NAME = 'DevOpsAgentRole-WebappAdmin';

/**
 * Pre-provisions the two IAM roles the AWS DevOps Agent space creation wizard requires.
 *
 * This construct creates nothing but roles. The agent space itself is created by the sibling
 * DevOpsAgentSpace construct, which looks these roles up by name so no IAM write permissions
 * are needed at space-creation time.
 */
export class DevOpsAgentRoles extends Construct {
    /** Assumed by the DevOps Agent service to monitor and investigate resources in this account. */
    public readonly agentRole: Role;

    /** Operator app role — assumed by participants when they sign in to the DevOps Agent web app. */
    public readonly operatorRole: Role;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        const stack = Stack.of(this);
        const account = stack.account;

        // ── Agent access role ──────────────────────────────────────────────────────────
        this.agentRole = new Role(this, 'AgentRole', {
            roleName: DEVOPS_AGENT_ROLE_NAME,
            description:
                'Assumed by the AWS DevOps Agent service to monitor and investigate resources in the workshop account',
            assumedBy: new ServicePrincipal('aidevops.amazonaws.com', {
                conditions: { StringEquals: { 'aws:SourceAccount': account } },
            }),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AIDevOpsAgentAccessPolicy')],
            inlinePolicies: {
                // The agent creates a Resource Explorer service-linked role on first use if one
                // does not already exist. This inline policy grants the minimum permission for that.
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
        this.operatorRole = new Role(this, 'OperatorRole', {
            roleName: DEVOPS_AGENT_OPERATOR_ROLE_NAME,
            description: 'Operator app role for DevOps Agent — assumed by workshop participants via the web app',
            assumedBy: new ServicePrincipal('aidevops.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AIDevOpsOperatorAppAccessPolicy')],
        });

        // A space keeps the role ARNs it was created with. Removing a role out from under a live
        // space breaks it. Retained on stack delete; workshop teardown cleans up explicitly.
        for (const role of [this.agentRole, this.operatorRole]) {
            role.applyRemovalPolicy(RemovalPolicy.RETAIN);
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
