/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Unit tests for the TdirEscalatedRole construct.
 *
 * Participants can assume AgentEscalatedAccess and rewrite its inline policy, so the boundary
 * capping it is the only thing standing between them and IAM write. These tests pin the two
 * properties that keep the scenario's real escalation harmless.
 *
 * @packageDocumentation
 */

import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TdirEscalatedRole } from '../lib/constructs/tdir-escalated-role';

interface Statement {
    Sid?: string;
    Action: string | string[];
    Condition?: Record<string, Record<string, unknown>>;
}

function synthesize(): Template {
    const app = new App();
    const stack = new Stack(app, 'TestStack', { env: { account: '111122223333', region: 'us-west-2' } });
    new TdirEscalatedRole(stack, 'TdirEscalatedRole');
    return Template.fromStack(stack);
}

function policyByName(template: Template, name: string): { logicalId: string; statements: Statement[] } {
    const policies = template.findResources('AWS::IAM::ManagedPolicy');
    const entry = Object.entries(policies).find(([, p]) => p.Properties?.ManagedPolicyName === name);
    expect(entry).toBeDefined();
    const [logicalId, policy] = entry!;
    return { logicalId, statements: policy.Properties.PolicyDocument.Statement as Statement[] };
}

const actionsOf = (statements: Statement[]): string[] => statements.flatMap((s) => [s.Action].flat());

test('TdirWorkshopBoundary, which caps the participant-assumable role, allows no IAM write', () => {
    const { statements } = policyByName(synthesize(), 'TdirWorkshopBoundary');
    const iamActions = actionsOf(statements).filter((a) => a.startsWith('iam:'));
    expect(iamActions.sort()).toEqual(['iam:Get*', 'iam:List*']);
});

test('the compromised agent role is capped by its own boundary, not TdirWorkshopBoundary', () => {
    const template = synthesize();
    const { logicalId } = policyByName(template, 'TdirCompromisedAgentBoundary');
    const roles = template.findResources('AWS::IAM::Role');
    const role = Object.values(roles).find((r) => r.Properties?.RoleName === 'TdirCompromisedAgentRole');
    expect(role?.Properties.PermissionsBoundary).toEqual({ Ref: logicalId });
});

test('TdirCompromisedAgentBoundary only creates roles that carry TdirWorkshopBoundary', () => {
    const template = synthesize();
    const workshop = policyByName(template, 'TdirWorkshopBoundary');
    const { statements } = policyByName(template, 'TdirCompromisedAgentBoundary');

    const createRole = statements.filter((s) => actionsOf([s]).includes('iam:CreateRole'));
    expect(createRole).toHaveLength(1);
    expect(createRole[0].Condition).toEqual({
        StringEquals: { 'iam:PermissionsBoundary': { Ref: workshop.logicalId } },
    });

    const iamWrites = actionsOf(statements).filter((a) => a.startsWith('iam:') && !/^iam:(Get|List)\*$/.test(a));
    expect(iamWrites.sort()).toEqual(['iam:CreateRole', 'iam:PutRolePolicy']);
});
