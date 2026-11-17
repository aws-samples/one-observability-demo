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
 * > The escalation is real in *shape* and harmless in *effect*, enforced by two permissions
 * > boundaries rather than by trust policies:
 * >
 * > 1. `TdirWorkshopBoundary` caps the escalated role, `AgentEscalatedAccess`. It allows only
 * >    read-only calls plus the Bedrock guardrail lifecycle, and **no IAM write of any kind**.
 * >    As a permissions boundary it caps the role's effective permissions whatever its inline
 * >    policies say, including any inline policy a participant writes while containing it.
 * > 2. `TdirCompromisedAgentBoundary` caps `TdirCompromisedAgentRole`, the only role that needs
 * >    IAM write: `iam:CreateRole` and `iam:PutRolePolicy` under `/tdir-workshop/`, and
 * >    `CreateRole` only when the request attaches `TdirWorkshopBoundary`. Every role it creates
 * >    is therefore capped by the boundary without IAM write.
 * > 3. The escalated role's inline policy deliberately *looks* administrative, because the
 * >    workshop asks participants to observe overbroad permissions. The boundary means it
 * >    confers nothing dangerous.
 * >
 * > Participants can assume `AgentEscalatedAccess` and write its inline policy (Labs 1.2 and 3),
 * > so `TdirWorkshopBoundary` must never allow an IAM write. If it allowed `iam:CreateRole`, a
 * > participant could create an unbounded role trusting their own account and grant it `*`.
 * > Do not add IAM write to it, and do not remove the boundary condition on `iam:CreateRole`.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { stableCfnOutput } from '../utils/stable-output';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
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
    /** Boundary that caps every workshop-created role, the escalated role included. No IAM write. */
    public readonly boundary: ManagedPolicy;
    /** Boundary of the compromised agent role: `boundary` plus creating boundary-capped workshop roles. */
    public readonly compromisedAgentBoundary: ManagedPolicy;
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
        // Both boundaries start from these statements; a factory, because a PolicyStatement
        // belongs to one document.
        const readOnlyAndGuardrailLifecycle = (): PolicyStatement[] => [
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
        ];
        this.boundary = new ManagedPolicy(this, 'Boundary', {
            managedPolicyName: 'TdirWorkshopBoundary',
            description: 'Caps every TDIR workshop role. The escalation is real in shape and harmless in effect.',
            statements: readOnlyAndGuardrailLifecycle(),
        });

        // The compromised role's ceiling: the escalated role's, plus the two IAM writes the
        // seeded chain performs. Separate from `boundary` because participants can use the
        // escalated role, and it must never be able to create or widen a role.
        this.compromisedAgentBoundary = new ManagedPolicy(this, 'CompromisedAgentBoundary', {
            managedPolicyName: 'TdirCompromisedAgentBoundary',
            description:
                'Caps the TDIR compromised agent role: read-only, guardrail lifecycle, and creating boundary-capped workshop roles.',
            statements: [
                ...readOnlyAndGuardrailLifecycle(),
                new PolicyStatement({
                    // Only with TdirWorkshopBoundary attached, so a created role can never hold
                    // IAM write: a ceiling cannot be raised by the role it caps.
                    sid: 'CreateBoundaryCappedWorkshopRoles',
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
                    sid: 'WriteWorkshopRoleInlinePolicies',
                    effect: Effect.ALLOW,
                    actions: ['iam:PutRolePolicy'],
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
            permissionsBoundary: this.compromisedAgentBoundary,
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
                    // Write only: the seeding script clears previous runs with its own credentials.
                    sid: 'AttachPolicyToWorkshopRoles',
                    effect: Effect.ALLOW,
                    actions: ['iam:PutRolePolicy'],
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

        stableCfnOutput(this, 'TdirCompromisedAgentRoleArn', {
            value: this.compromisedAgentRole.roleArn,
            description: 'Assume this to run the TDIR escalation chain (boundary-capped)',
        });
        stableCfnOutput(this, 'TdirEscalatedRoleArn', {
            value: this.escalatedRoleArn,
            description: 'Created at seed time by the compromised agent role',
        });
        stableCfnOutput(this, 'TdirWorkshopBoundaryArn', {
            value: this.boundary.managedPolicyArn,
            description: 'Permissions boundary capping every TDIR workshop role',
        });
        // Published to SSM as well as to outputs. Participants read environment-specific values
        // with `aws ssm get-parameter`, which is the idiom the observability workshop already
        // documents; CloudFormation outputs are for facilitators reading the deployment stack.
        Utilities.createSsmParameters(
            this,
            PARAMETER_STORE_PREFIX,
            new Map([
                ['tdir/escalatedrolename', ESCALATED_ROLE_NAME],
                ['tdir/compromisedagentrolename', COMPROMISED_AGENT_ROLE_NAME],
                // The ARN as well as the name: these roles live under a non-default IAM path, so
                // the ARN cannot be assembled from the name alone. sts:AssumeRole needs the full
                // ARN, and a participant who guesses `role/AgentEscalatedAccess` gets a failure.
                ['tdir/escalatedrolearn', this.escalatedRoleArn],
                ['tdir/compromisedagentrolearn', this.compromisedAgentRole.roleArn],
            ]),
        );

        // Names, not just ARNs: every IAM CLI call the workshop asks participants to run takes
        // --role-name, and these roles live under a non-default path so the name cannot be
        // derived from the ARN by splitting on '/'.
        stableCfnOutput(this, 'TdirEscalatedRoleName', {
            value: ESCALATED_ROLE_NAME,
            description: 'Role the scenario evidence blames; target of iam delete-role-policy',
        });
        stableCfnOutput(this, 'TdirCompromisedAgentRoleName', {
            value: COMPROMISED_AGENT_ROLE_NAME,
            description: 'Stand-in for the compromised agent runtime role',
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
            this.compromisedAgentBoundary,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'This is a permissions boundary, not a grant: read-only wildcards plus iam:CreateRole and iam:PutRolePolicy scoped to the /tdir-workshop/ path, with CreateRole requiring TdirWorkshopBoundary on the new role.',
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
