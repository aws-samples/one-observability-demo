/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Unit tests for the OmniRoles construct.
 *
 * The role names and policy documents here are asserted against what CloudWatch Omni's console
 * setup actually creates, because the workshop participant policy grants PassRole by name.
 *
 * @packageDocumentation
 */

import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { OmniRoles, OmniRolesProperties } from '../lib/constructs/omni-roles';

const ACCOUNT = '111122223333';
const REGION = 'us-west-2';

function synthesize(properties: OmniRolesProperties = {}): Template {
    const app = new App();
    const stack = new Stack(app, 'TestStack', { env: { account: ACCOUNT, region: REGION } });
    new OmniRoles(stack, 'OmniRoles', properties);
    return Template.fromStack(stack);
}

function roleByName(template: Template, name: string) {
    const roles = template.findResources('AWS::IAM::Role');
    const match = Object.values(roles).find((r) => r.Properties?.RoleName === name);
    expect(match).toBeDefined();
    return match as { Properties: Record<string, unknown> };
}

test('creates three roles by default', () => {
    expect(Object.keys(synthesize().findResources('AWS::IAM::Role'))).toHaveLength(3);
});

test('role names and paths match the participant policy PassRole grants', () => {
    const template = synthesize();
    const space = roleByName(template, 'CloudWatchOmniSpaceAccessRole-workshop');
    const dataset = roleByName(template, 'CloudWatchOmniDatasetIntegrationExecutionRole-workshop');
    const evaluation = roleByName(template, 'WaggleOnlineEvaluationRole');

    expect(space.Properties.Path).toBe('/service-role/');
    expect(dataset.Properties.Path).toBe('/service-role/');
    // Granted by exact ARN at the root path, so it must not be under /service-role/.
    expect(evaluation.Properties.Path).toBeUndefined();
});

// The console emits all four actions in a single statement with no Sid. Asserted exactly, because
// CDK's assumedBy would otherwise split sts:AssumeRole into a statement of its own.
test('space access role trusts CloudWatch Omni for this account only', () => {
    synthesize().hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'CloudWatchOmniSpaceAccessRole-workshop',
        AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { Service: 'cloudwatch.amazonaws.com' },
                    Action: ['sts:AssumeRole', 'sts:TagSession', 'sts:SetSourceIdentity', 'sts:SetContext'],
                    Condition: { StringEquals: { 'aws:SourceAccount': ACCOUNT } },
                },
            ],
        },
    });
});

test('space access role carries the three AWS managed Omni policies', () => {
    const space = roleByName(synthesize(), 'CloudWatchOmniSpaceAccessRole-workshop');
    const arns = JSON.stringify(space.Properties.ManagedPolicyArns);
    for (const policy of [
        'CloudWatchOmniSpaceAccessPolicy',
        'CloudWatchOmniAWSIntegrationPolicy',
        'CloudWatchOmniModelInferencePolicy',
    ]) {
        expect(arns).toContain(`:iam::aws:policy/${policy}`);
    }
});

test('dataset integration role is assumed by CloudWatch Logs and pins the source ARN', () => {
    synthesize().hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'CloudWatchOmniDatasetIntegrationExecutionRole-workshop',
        AssumeRolePolicyDocument: {
            Statement: Match.arrayWith([
                Match.objectLike({
                    Principal: { Service: 'logs.amazonaws.com' },
                    Condition: {
                        StringEquals: { 'aws:SourceAccount': ACCOUNT },
                        ArnLike: {
                            'aws:SourceArn': `arn:aws:observabilityadmin:*:${ACCOUNT}:dataset-integration/*`,
                        },
                    },
                }),
            ]),
        },
    });
});

test('dataset integration role grants exactly the two forwarding actions', () => {
    const dataset = roleByName(synthesize(), 'CloudWatchOmniDatasetIntegrationExecutionRole-workshop');
    const policies = dataset.Properties.Policies as {
        PolicyName: string;
        PolicyDocument: { Statement: { Action: string; Resource: string }[] };
    }[];
    expect(policies).toHaveLength(1);
    expect(policies[0].PolicyName).toBe('OmniDatasetIntegrationPolicy');
    expect(policies[0].PolicyDocument.Statement.map((s) => s.Action)).toEqual([
        'logs:IntegrateWithDataset',
        'cloudwatch:PutRecords',
    ]);
});

test('online evaluation role includes the aws/spans index statement', () => {
    const evaluation = roleByName(synthesize(), 'WaggleOnlineEvaluationRole');
    const policies = evaluation.Properties.Policies as {
        PolicyName: string;
        PolicyDocument: { Statement: { Sid: string; Action: string[] }[] };
    }[];
    expect(policies[0].PolicyName).toBe('OnlineEvaluation');
    const statement = policies[0].PolicyDocument.Statement.find((s) => s.Sid === 'CloudWatchIndexPolicyStatement');
    expect(statement).toBeDefined();
    expect(statement!.Action).toEqual(['logs:DescribeIndexPolicies', 'logs:PutIndexPolicy']);
});

test('online evaluation role is trusted by AgentCore and scoped to evaluation resources', () => {
    synthesize().hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'WaggleOnlineEvaluationRole',
        AssumeRolePolicyDocument: {
            Statement: Match.arrayWith([
                Match.objectLike({
                    Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
                    Condition: {
                        StringEquals: {
                            'aws:SourceAccount': ACCOUNT,
                            'aws:ResourceAccount': ACCOUNT,
                        },
                        ArnLike: {
                            'aws:SourceArn': [
                                `arn:aws:bedrock-agentcore:*:${ACCOUNT}:evaluator/*`,
                                `arn:aws:bedrock-agentcore:*:${ACCOUNT}:online-evaluation-config/*`,
                            ],
                        },
                    },
                }),
            ]),
        },
    });
});

test('online evaluation role can be disabled', () => {
    const template = synthesize({ createOnlineEvaluationRole: false });
    expect(Object.keys(template.findResources('AWS::IAM::Role'))).toHaveLength(2);
    const names = Object.values(template.findResources('AWS::IAM::Role')).map((r) => r.Properties.RoleName);
    expect(names).not.toContain('WaggleOnlineEvaluationRole');
});

test('roles are retained so deleting the stack cannot break a live space', () => {
    const roles = synthesize().findResources('AWS::IAM::Role');
    for (const role of Object.values(roles)) {
        expect(role.DeletionPolicy).toBe('Retain');
    }
});
