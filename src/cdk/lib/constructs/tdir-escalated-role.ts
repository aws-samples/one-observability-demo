/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Real-but-harmless privilege escalation scaffolding for the TDIR workshop, controlled by
 * the `CUSTOM_ENABLE_TDIR_ESCALATED_ROLE` flag.
 *
 * Amazon Detective builds its behavior graph from **real CloudTrail**, so a scenario made of
 * fabricated log entries is invisible to it. For the Detective step to work, the escalation
 * has to actually happen: a role really creates another role, really assumes it, and really
 * calls Bedrock and IAM. `scripts/tdir-seed-scenarios.py` performs that chain; this construct
 * provides the two roles it needs.
 *
 * > **Safety — read before changing anything here.**
 * >
 * > The escalation is real in *shape* and harmless in *effect*, enforced by a permissions
 * > boundary rather than by trust policies:
 * >
 * > 1. `TdirWorkshopBoundary` allows only read-only calls plus Bedrock guardrail lifecycle.
 * >    It is attached as a **permissions boundary**, so it caps the effective permissions of
 * >    any role that carries it no matter what its inline policies say.
 * > 2. `TdirCompromisedAgentRole` may only call `iam:CreateRole` for roles under the
 * >    `/tdir-workshop/` path, and only when the request attaches that boundary. It therefore
 * >    cannot mint a role more powerful than the boundary.
 * > 3. The escalated role's inline policy deliberately *looks* administrative, because the
 * >    workshop asks participants to observe overbroad permissions. The boundary means it
 * >    confers nothing dangerous.
 * >
 * > Do not remove the boundary condition on `iam:CreateRole`, and do not widen the boundary.
 * > Those two things are what make a genuinely-performed privilege escalation safe to run.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import { AccountRootPrincipal, Effect, ManagedPolicy, Policy, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';

/** Physical name the scenario evidence and the remediation Lambda both match on. */
export const ESCALATED_ROLE_NAME = 'AgentEscalatedAccess';

/** Stand-in for the compromised agent's runtime role, as the narrative names it. */
export const COMPROMISED_AGENT_ROLE_NAME = 'TdirCompromisedAgentRole';

/** IAM path every workshop-created role lives under, so grants can be scoped to it. */
export const WORKSHOP_ROLE_PATH = '/tdir-workshop/';

/**
 * Creates the two roles the seeding script uses to perform a real, boundary-capped
 * privilege escalation, so Amazon Detective has genuine CloudTrail activity to correlate.
 */
export class TdirEscalatedRole extends Construct {
    /** Boundary that caps every workshop-created role. */
    public readonly boundary: ManagedPolicy;
    /** Stand-in for the compromised agent runtime role; starts the escalation chain. */
    public readonly compromisedAgentRole: Role;
    /** ARN the escalated role will have once the seeding script creates it. */
    public readonly escalatedRoleArn: string;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        const { account, region } = Stack.of(this);
        this.escalatedRoleArn = `arn:aws:iam::${account}:role${WORKSHOP_ROLE_PATH}${ESCALATED_ROLE_NAME}`;

        // --- The control that makes a real escalation safe ---
        // Everything a workshop role can ever do, regardless of its own policies. Read-only,
        // plus the Bedrock guardrail lifecycle the scenario needs to generate CloudTrail.
        this.boundary = new ManagedPolicy(this, 'Boundary', {
            managedPolicyName: 'TdirWorkshopBoundary',
            description: 'Caps every TDIR workshop role. The escalation is real in shape and harmless in effect.',
            statements: [
                new PolicyStatement({
                    sid: 'ReadOnlyReconnaissance',
                    effect: Effect.ALLOW,
                    actions: [
                        'sts:GetCallerIdentity',
                        'iam:Get*',
                        'iam:List*',
                        'bedrock:List*',
                        'bedrock:Get*',
                        's3:ListAllMyBuckets',
                        'cloudtrail:LookupEvents',
                    ],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    // Scoped to guardrails so the scenario can create and delete a throwaway
                    // one, producing the bedrock:DeleteGuardrail call the workshop looks for.
                    sid: 'GuardrailLifecycleForScenario',
                    effect: Effect.ALLOW,
                    actions: ['bedrock:CreateGuardrail', 'bedrock:DeleteGuardrail'],
                    resources: [`arn:aws:bedrock:${region}:${account}:guardrail/*`],
                }),
                new PolicyStatement({
                    // Only within the workshop path, and only with the boundary attached.
                    sid: 'WorkshopRoleManagementOnly',
                    effect: Effect.ALLOW,
                    actions: ['iam:CreateRole', 'iam:PutRolePolicy', 'iam:DeleteRole', 'iam:DeleteRolePolicy'],
                    resources: [`arn:aws:iam::${account}:role${WORKSHOP_ROLE_PATH}*`],
                }),
            ],
        });

        // --- Stand-in for the compromised agent runtime role ---
        // Assumable by the account so the seeding script can act *as* this role: Detective
        // records the caller identity, so the CreateRole edge only appears in the behavior
        // graph if this role genuinely makes the call.
        this.compromisedAgentRole = new Role(this, 'CompromisedAgentRole', {
            roleName: COMPROMISED_AGENT_ROLE_NAME,
            path: WORKSHOP_ROLE_PATH,
            assumedBy: new AccountRootPrincipal(),
            permissionsBoundary: this.boundary,
            description: 'TDIR workshop: stands in for the compromised agent runtime role. Boundary-capped.',
        });

        const escalationPolicy = new Policy(this, 'EscalationPolicy', {
            statements: [
                new PolicyStatement({
                    // Creating the escalated role is only permitted inside the workshop path
                    // AND only when the request attaches the boundary. Without the condition
                    // this role could mint an unrestricted role, which is exactly the thing
                    // the boundary exists to prevent.
                    sid: 'CreateEscalatedRoleWithBoundaryOnly',
                    effect: Effect.ALLOW,
                    actions: ['iam:CreateRole'],
                    resources: [`arn:aws:iam::${account}:role${WORKSHOP_ROLE_PATH}*`],
                    conditions: {
                        StringEquals: {
                            'iam:PermissionsBoundary': this.boundary.managedPolicyArn,
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'AttachPolicyToWorkshopRoles',
                    effect: Effect.ALLOW,
                    actions: ['iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:DeleteRole'],
                    resources: [`arn:aws:iam::${account}:role${WORKSHOP_ROLE_PATH}*`],
                }),
                new PolicyStatement({
                    sid: 'AssumeTheEscalatedRole',
                    effect: Effect.ALLOW,
                    actions: ['sts:AssumeRole'],
                    resources: [this.escalatedRoleArn],
                }),
                new PolicyStatement({
                    sid: 'GuardrailLifecycleForScenario',
                    effect: Effect.ALLOW,
                    actions: ['bedrock:CreateGuardrail', 'bedrock:DeleteGuardrail', 'bedrock:ListGuardrails'],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    sid: 'ReadOnly',
                    effect: Effect.ALLOW,
                    actions: ['sts:GetCallerIdentity', 'iam:GetRole', 'iam:ListRoles'],
                    resources: ['*'],
                }),
            ],
        });
        escalationPolicy.attachToRole(this.compromisedAgentRole);

        new CfnOutput(this, 'CompromisedAgentRoleArn', {
            value: this.compromisedAgentRole.roleArn,
            description: 'Assume this to run the TDIR escalation chain (boundary-capped)',
        });
        new CfnOutput(this, 'EscalatedRoleArn', {
            value: this.escalatedRoleArn,
            description: 'Created at seed time by the compromised agent role',
        });
        new CfnOutput(this, 'WorkshopBoundaryArn', {
            value: this.boundary.managedPolicyArn,
            description: 'Permissions boundary capping every TDIR workshop role',
        });

        NagSuppressions.addResourceSuppressions(
            this.boundary,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'This is a permissions boundary, not a grant: the wildcards define the ceiling for workshop roles, and every action in it is read-only apart from the guardrail lifecycle the scenario requires.',
                },
            ],
            true,
        );
        NagSuppressions.addResourceSuppressions(
            escalationPolicy,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Role and guardrail actions are scoped to the /tdir-workshop/ path and to guardrails; iam:CreateRole additionally requires the permissions boundary, so this role cannot create anything more privileged than itself.',
                },
            ],
            true,
        );
    }
}
