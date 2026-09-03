/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Simulated compromised IAM role for the TDIR workshop, controlled by the
 * `CUSTOM_ENABLE_TDIR_ESCALATED_ROLE` flag.
 *
 * The TDIR scenario's narrative is that the agent escalated its own privileges by creating
 * a role named `AgentEscalatedAccess`, disabled the Bedrock guardrails with it, and
 * exfiltrated its credentials. Security Hub findings and the seeded CloudTrail evidence
 * both name that role, so participants are told to inspect it — which only works if it
 * actually exists.
 *
 * > **Safety**: this role is deliberately **unassumable**. Its trust policy is a single
 * > explicit `Deny` for all principals on every assume-role action, and IAM evaluates Deny
 * > ahead of any Allow, so no principal in any account can obtain credentials for it. It
 * > exists to be *looked at*, not used. The permissive inline policy is what makes the
 * > workshop's "this role has administrative permissions" conclusion verifiable in the
 * > console; it confers nothing while the role cannot be assumed.
 * >
 * > Do not replace the Deny with an Allow, and do not "fix" the trust policy to make the
 * > role usable. Verify after any change with:
 * > `aws sts assume-role --role-arn <arn> --role-session-name check` — it must fail.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import { CfnRole } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';

/** Physical name the scenario evidence refers to. Must match the seeded findings. */
export const ESCALATED_ROLE_NAME = 'AgentEscalatedAccess';

/**
 * A CDK construct that creates the simulated escalated role the TDIR scenario blames for
 * guardrail disablement and credential exfiltration.
 *
 * Workshop participants pivot to this role from the Security Hub findings and from
 * Detective, and the remediation Lambda contains it by attaching a deny-all policy.
 */
export class TdirEscalatedRole extends Construct {
    /** The simulated compromised role. */
    public readonly role: CfnRole;
    /** ARN of the simulated compromised role. */
    public readonly roleArn: string;

    /**
     * Creates a new TdirEscalatedRole construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     */
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const { account, region } = Stack.of(this);

        // Written as an L1 so the physical role name is exact: the seeded Security Hub
        // findings, CloudTrail evidence and remediation Lambda all match on it by name.
        this.role = new CfnRole(this, 'Role', {
            roleName: ESCALATED_ROLE_NAME,
            description:
                'TDIR workshop: simulated escalated role. Intentionally unassumable - investigation target only.',
            // Deny-only trust policy: an explicit Deny for every principal and every
            // assume-role action. IAM evaluates Deny ahead of any Allow, so no principal
            // in any account can ever obtain credentials for this role. Written this way
            // rather than as an Allow with an unsatisfiable Condition so that anyone
            // auditing IAM sees the intent immediately instead of having to reason about
            // a condition key.
            assumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                    {
                        Sid: 'DenyAllAssumeRole',
                        Effect: 'Deny',
                        Principal: { AWS: '*' },
                        Action: ['sts:AssumeRole', 'sts:AssumeRoleWithWebIdentity', 'sts:AssumeRoleWithSAML'],
                    },
                ],
            },
            policies: [
                {
                    policyName: 'AgentEscalatedInlinePolicy',
                    policyDocument: {
                        Version: '2012-10-17',
                        Statement: [
                            {
                                Sid: 'SimulatedOverbroadGrant',
                                Effect: 'Allow',
                                Action: '*',
                                Resource: '*',
                            },
                        ],
                    },
                },
            ],
            tags: [
                { key: 'Name', value: ESCALATED_ROLE_NAME },
                { key: 'tdir:purpose', value: 'simulated-compromise-evidence' },
                { key: 'tdir:assumable', value: 'false' },
            ],
        });

        this.roleArn = `arn:aws:iam::${account}:role/${ESCALATED_ROLE_NAME}`;

        new CfnOutput(this, 'EscalatedRoleArn', {
            value: this.roleArn,
            description: `Simulated compromised role for the TDIR workshop (${region}, unassumable)`,
        });

        NagSuppressions.addResourceSuppressions(this.role, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Deliberately overbroad: this is simulated compromise evidence for participants to find. The trust policy is unsatisfiable, so the grant is never exercisable.',
            },
        ]);
    }
}
