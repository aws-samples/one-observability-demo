/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Pre-provisions the AWS DevOps Agent space for the One Observability Workshop.
 *
 * This construct creates the agent space and account association only. It references the
 * IAM roles by ARN — the roles are pre-provisioned separately by DevOpsAgentRoles, following
 * the same split used by OmniRoles. No `iam:CreateRole` or `iam:AttachRolePolicy` is required
 * at space-creation time.
 *
 * Participants still connect the space to Omni themselves (Settings → Integrations →
 * AWS DevOps Agent → Select space), so the hands-on step is preserved.
 *
 * @packageDocumentation
 */

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { IRole, Role } from 'aws-cdk-lib/aws-iam';
import { CfnAgentSpace, CfnAssociation } from 'aws-cdk-lib/aws-devopsagent';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { DEVOPS_AGENT_ROLE_NAME, DEVOPS_AGENT_OPERATOR_ROLE_NAME } from './devops-agent-roles';

const SPACE_NAME = 'one-observability-workshop';

/**
 * Properties for DevOpsAgentSpace.
 *
 * Both roles must be pre-provisioned before this construct is instantiated.
 * Use DevOpsAgentRoles (or supply your own) and pass the resulting roles here.
 */
export interface DevOpsAgentSpaceProps {
    /**
     * The IAM role assumed by the AWS DevOps Agent service to monitor this account.
     * Must be pre-provisioned — this construct does not create IAM roles.
     */
    readonly agentRole: IRole;

    /**
     * The operator app role used by participants to sign in to the DevOps Agent web app.
     * Must be pre-provisioned — this construct does not create IAM roles.
     */
    readonly operatorRole: IRole;
}

/**
 * Creates the `one-observability-workshop` AWS DevOps Agent space and its account association,
 * using pre-provisioned IAM roles supplied via props.
 */
export class DevOpsAgentSpace extends Construct {
    /** The agent space. Its ID is available as `agentSpace.ref`. */
    public readonly agentSpace: CfnAgentSpace;

    constructor(scope: Construct, id: string, props: DevOpsAgentSpaceProps) {
        super(scope, id);

        // ── Agent space ────────────────────────────────────────────────────────────────
        // Roles are referenced by ARN from props — no IAM writes needed here.
        this.agentSpace = new CfnAgentSpace(this, 'Space', {
            name: SPACE_NAME,
            description:
                'One Observability Workshop — pre-provisioned for Application Observability and Analytics modules',
            operatorApp: {
                iam: {
                    roleArn: props.operatorRole.roleArn,
                },
            },
        });

        // ── Account association ────────────────────────────────────────────────────────
        // Registers this account as a monitored account so the agent can read its telemetry.
        const association = new CfnAssociation(this, 'AccountAssociation', {
            agentSpaceId: this.agentSpace.ref,
            associationType: 'AWS',
            monitoringRoleArn: props.agentRole.roleArn,
        });

        association.addDependency(this.agentSpace);

        // Retain the space on stack delete — the association and space keep references to the
        // monitoring role; removing either while in use breaks investigations. Workshop teardown
        // cleans up explicitly.
        this.agentSpace.applyRemovalPolicy(RemovalPolicy.RETAIN);

        NagSuppressions.addResourceSuppressions(this, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'No IAM resources are created by this construct — roles are referenced by ARN from DevOpsAgentRoles',
            },
        ]);
    }
}

/**
 * Convenience factory: looks up the pre-provisioned DevOps Agent roles by name and
 * creates the space in one call. Use this when DevOpsAgentRoles and DevOpsAgentSpace
 * are both enabled in the same stack.
 */
export function createDevOpsAgentSpaceFromPreProvisionedRoles(scope: Construct, id: string): DevOpsAgentSpace {
    const stack = Stack.of(scope);
    const account = stack.account;
    const region = stack.region;

    const agentRole = Role.fromRoleArn(
        scope,
        `${id}AgentRoleLookup`,
        `arn:aws:iam::${account}:role/${DEVOPS_AGENT_ROLE_NAME}`,
    );

    const operatorRole = Role.fromRoleArn(
        scope,
        `${id}OperatorRoleLookup`,
        `arn:aws:iam::${account}:role/${DEVOPS_AGENT_OPERATOR_ROLE_NAME}`,
    );

    void region; // referenced for future cross-region guard if needed

    return new DevOpsAgentSpace(scope, id, { agentRole, operatorRole });
}
