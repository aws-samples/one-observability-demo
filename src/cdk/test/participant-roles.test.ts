/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Unit tests for the ParticipantRoles construct.
 *
 * Names and paths are asserted exactly, because the workshop participant policy grants iam:PassRole
 * and iam:AttachRolePolicy by name. A rename here without the matching policy change breaks a module.
 *
 * @packageDocumentation
 */

import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import {
    DYNAMODB_WORKSHOP_POLICY_NAME,
    PARTICIPANT_ROLE_NAMES,
    ParticipantRoles,
    ParticipantRolesProperties,
    RUM_IDENTITY_POOL_NAME,
} from '../lib/constructs/participant-roles';

const ACCOUNT = '111122223333';
const REGION = 'us-west-2';

function synthesize(properties: ParticipantRolesProperties = {}): Template {
    const app = new App();
    const stack = new Stack(app, 'TestStack', { env: { account: ACCOUNT, region: REGION } });
    new ParticipantRoles(stack, 'ParticipantRoles', properties);
    return Template.fromStack(stack);
}

function roleByName(template: Template, name: string) {
    const roles = template.findResources('AWS::IAM::Role');
    const match = Object.values(roles).find((r) => r.Properties?.RoleName === name);
    expect(match).toBeDefined();
    return match as { Properties: Record<string, unknown>; DeletionPolicy?: string };
}

test('creates five roles by default', () => {
    expect(Object.keys(synthesize().findResources('AWS::IAM::Role'))).toHaveLength(5);
});

test('skips the RUM identity pool and role when disabled', () => {
    const template = synthesize({ createRumIdentityPool: false });
    expect(Object.keys(template.findResources('AWS::IAM::Role'))).toHaveLength(4);
    template.resourceCountIs('AWS::Cognito::IdentityPool', 0);
});

test('role names and paths match the participant policy grants', () => {
    const template = synthesize();
    expect(roleByName(template, PARTICIPANT_ROLE_NAMES.CANARY).Properties.Path).toBe('/service-role/');
    expect(roleByName(template, PARTICIPANT_ROLE_NAMES.LAMBDA).Properties.Path).toBe('/service-role/');
    // Passable through AWSGrafanaAccountAdministrator, which allows PassRole of any role to grafana.
    expect(roleByName(template, PARTICIPANT_ROLE_NAMES.GRAFANA).Properties.Path).toBe('/service-role/');
    // Granted by name at the root path.
    expect(roleByName(template, PARTICIPANT_ROLE_NAMES.INVESTIGATIONS).Properties.Path).toBeUndefined();
    // Must match the existing RUM-Monitor-* -> cognito-identity PassRole grant.
    expect(PARTICIPANT_ROLE_NAMES.RUM_UNAUTH.startsWith('RUM-Monitor-')).toBe(true);
    expect(roleByName(template, PARTICIPANT_ROLE_NAMES.RUM_UNAUTH).Properties.Path).toBeUndefined();
});

test('canary and Lambda roles trust Lambda', () => {
    const template = synthesize();
    for (const name of [PARTICIPANT_ROLE_NAMES.CANARY, PARTICIPANT_ROLE_NAMES.LAMBDA]) {
        template.hasResourceProperties('AWS::IAM::Role', {
            RoleName: name,
            AssumeRolePolicyDocument: {
                Statement: [
                    Match.objectLike({ Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }),
                ],
            },
        });
    }
});

test('canary role can only publish metrics to the CloudWatchSynthetics namespace', () => {
    synthesize().hasResourceProperties('AWS::IAM::Role', {
        RoleName: PARTICIPANT_ROLE_NAMES.CANARY,
        Policies: [
            {
                PolicyName: 'CloudWatchSyntheticsPolicy',
                PolicyDocument: {
                    // arrayWith is order-sensitive: artifacts statement comes before metrics.
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Action: ['s3:PutObject', 's3:GetObject'],
                            Resource: `arn:aws:s3:::cw-syn-results-${ACCOUNT}-${REGION}/*`,
                        }),
                        Match.objectLike({
                            Action: 'cloudwatch:PutMetricData',
                            Condition: { StringEquals: { 'cloudwatch:namespace': 'CloudWatchSynthetics' } },
                        }),
                    ]),
                },
            },
        ],
    });
});

test('Lambda role carries the Logs Insights actions the custom-widget module needs', () => {
    synthesize().hasResourceProperties('AWS::IAM::Role', {
        RoleName: PARTICIPANT_ROLE_NAMES.LAMBDA,
        Policies: [
            {
                PolicyName: 'LogsInsightsQuery',
                PolicyDocument: {
                    Statement: [
                        Match.objectLike({
                            Action: Match.arrayWith(['logs:StartQuery', 'logs:GetQueryResults']),
                        }),
                    ],
                },
            },
        ],
    });
});

test('Grafana and Investigations roles are pinned to this account', () => {
    const template = synthesize();
    template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: PARTICIPANT_ROLE_NAMES.GRAFANA,
        AssumeRolePolicyDocument: {
            Statement: [
                Match.objectLike({
                    Principal: { Service: 'grafana.amazonaws.com' },
                    Condition: Match.objectLike({ StringEquals: { 'aws:SourceAccount': ACCOUNT } }),
                }),
            ],
        },
    });
    template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: PARTICIPANT_ROLE_NAMES.INVESTIGATIONS,
        AssumeRolePolicyDocument: {
            Statement: [
                Match.objectLike({
                    Principal: { Service: 'aiops.amazonaws.com' },
                    Condition: Match.objectLike({ StringEquals: { 'aws:SourceAccount': ACCOUNT } }),
                }),
            ],
        },
    });
});

test('RUM unauthenticated role trusts only its identity pool', () => {
    const template = synthesize();
    template.hasResourceProperties('AWS::Cognito::IdentityPool', {
        IdentityPoolName: RUM_IDENTITY_POOL_NAME,
        AllowUnauthenticatedIdentities: true,
    });
    template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: PARTICIPANT_ROLE_NAMES.RUM_UNAUTH,
        AssumeRolePolicyDocument: {
            Statement: [
                Match.objectLike({
                    Action: 'sts:AssumeRoleWithWebIdentity',
                    Principal: { Federated: 'cognito-identity.amazonaws.com' },
                    Condition: {
                        StringEquals: { 'cognito-identity.amazonaws.com:aud': { Ref: Match.anyValue() } },
                        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
                    },
                }),
            ],
        },
    });
    template.resourceCountIs('AWS::Cognito::IdentityPoolRoleAttachment', 1);
});

test('DynamoDBWorkshopAccess matches the policy the Investigations lab used to paste inline', () => {
    synthesize().hasResourceProperties('AWS::IAM::ManagedPolicy', {
        ManagedPolicyName: DYNAMODB_WORKSHOP_POLICY_NAME,
        PolicyDocument: {
            Statement: [
                Match.objectLike({
                    Action: ['dynamodb:ListTables', 'dynamodb:DescribeTable', 'dynamodb:ListTagsOfResource'],
                    Resource: '*',
                }),
                Match.objectLike({
                    Action: 'dynamodb:PutItem',
                    Resource: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/Storage-StorageStack-DynamoDbddbPetadoption*`,
                }),
            ],
        },
    });
});

test('roles and the managed policy are retained on stack delete', () => {
    const template = synthesize();
    for (const name of Object.values(PARTICIPANT_ROLE_NAMES)) {
        expect(roleByName(template, name).DeletionPolicy).toBe('Retain');
    }
    const policies = template.findResources('AWS::IAM::ManagedPolicy');
    expect(Object.values(policies).every((p) => p.DeletionPolicy === 'Retain')).toBe(true);
});
