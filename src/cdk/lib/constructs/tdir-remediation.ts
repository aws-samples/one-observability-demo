/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * TDIR Automated Remediation construct for the One Observability Workshop.
 *
 * This module provisions automated response capabilities that trigger when
 * high-severity security findings are detected. It demonstrates the "respond"
 * phase of Threat Detection and Incident Response (TDIR).
 *
 * Remediation actions include:
 * - Isolating compromised AI agent runtimes (revoking IAM permissions)
 * - Quarantining knowledge base data sources
 * - Sending notifications for human review
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Runtime, Function as LambdaFunction, Code } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Role, ServicePrincipal, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Rule, EventPattern } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaTarget } from 'aws-cdk-lib/aws-events-targets';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { NagSuppressions } from 'cdk-nag';

/**
 * Configuration properties for the TdirRemediation construct.
 */
export interface TdirRemediationProperties {
    /** Minimum severity for triggering automated remediation (default: 7 = High) */
    minimumSeverity?: number;
    /** Log retention period */
    logRetentionDays?: RetentionDays;
}

/**
 * A CDK construct that creates automated remediation for security findings.
 *
 * Listens for GuardDuty findings via EventBridge and executes remediation:
 * 1. High-severity findings → Lambda isolates the affected resource
 * 2. All findings → Published to SNS for notification/audit
 *
 * Workshop participants can examine the remediation logic, extend it,
 * and observe how automated response correlates with Detective investigations.
 */
export class TdirRemediation extends Construct {
    /** SNS topic for security finding notifications */
    public readonly notificationTopic: Topic;
    /** The remediation Lambda function */
    public readonly remediationFunction: LambdaFunction;

    /**
     * Creates a new TdirRemediation construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for remediation
     */
    constructor(scope: Construct, id: string, properties?: TdirRemediationProperties) {
        super(scope, id);

        const props = properties || {};
        const minimumSeverity = props.minimumSeverity || 7;
        const retention = props.logRetentionDays || RetentionDays.ONE_WEEK;
        const region = Stack.of(this).region;
        const account = Stack.of(this).account;

        // SNS topic for security notifications
        this.notificationTopic = new Topic(this, 'SecurityNotifications', {
            displayName: 'TDIR Security Finding Notifications',
            enforceSSL: true,
        });

        // Log group for remediation function
        const logGroup = new LogGroup(this, 'RemediationLogGroup', {
            retention: retention,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // IAM role for the remediation Lambda
        const remediationRole = new Role(this, 'RemediationRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        });

        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
            }),
        );

        // Permissions to isolate agent runtimes
        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'bedrock-agentcore:StopAgentRuntime',
                    'bedrock-agentcore:GetAgentRuntime',
                    'bedrock-agentcore:ListAgentRuntimes',
                ],
                resources: [`arn:aws:bedrock-agentcore:${region}:${account}:runtime/*`],
            }),
        );

        // Permissions to revoke IAM sessions (isolate compromised roles)
        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'iam:PutRolePolicy',
                    'iam:GetRole',
                    'iam:ListRolePolicies',
                    'iam:ListAttachedRolePolicies',
                ],
                resources: [`arn:aws:iam::${account}:role/*PetFoodAgent*`],
            }),
        );

        // Permissions to quarantine knowledge base
        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['bedrock:GetKnowledgeBase', 'bedrock:DisassociateAgentKnowledgeBase'],
                resources: [`arn:aws:bedrock:${region}:${account}:knowledge-base/*`],
            }),
        );

        // Permissions to publish to SNS
        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['sns:Publish'],
                resources: [this.notificationTopic.topicArn],
            }),
        );

        // Remediation Lambda function
        this.remediationFunction = new LambdaFunction(this, 'RemediationFunction', {
            runtime: Runtime.PYTHON_3_13,
            handler: 'index.handler',
            role: remediationRole,
            timeout: Duration.seconds(60),
            logGroup: logGroup,
            environment: {
                SNS_TOPIC_ARN: this.notificationTopic.topicArn,
                MINIMUM_SEVERITY: minimumSeverity.toString(),
            },
            code: Code.fromInline(`
import json
import os
import boto3

def handler(event, context):
    """
    Automated remediation for GuardDuty findings.
    
    Actions based on finding type:
    - Agent-related findings: Stop the agent runtime and revoke IAM sessions
    - Knowledge base findings: Quarantine the data source
    - All high-severity findings: Publish notification for human review
    """
    print(f"Received event: {json.dumps(event)}")
    
    sns = boto3.client('sns')
    topic_arn = os.environ['SNS_TOPIC_ARN']
    min_severity = float(os.environ.get('MINIMUM_SEVERITY', '7'))
    
    detail = event.get('detail', {})
    finding_type = detail.get('type', '')
    severity = detail.get('severity', 0)
    title = detail.get('title', 'Unknown Finding')
    description = detail.get('description', '')
    account_id = detail.get('accountId', '')
    region = detail.get('region', '')
    
    response_actions = []
    
    # Determine remediation based on finding type
    if severity >= min_severity:
        # Check if finding involves Bedrock/Agent resources
        resource = detail.get('resource', {})
        resource_type = resource.get('resourceType', '')
        
        if 'Bedrock' in finding_type or 'bedrock' in str(resource):
            # Isolate the agent runtime
            response_actions.append(isolate_agent_runtime(region, account_id))
        
        if 'UnauthorizedAccess' in finding_type or 'CredentialAccess' in finding_type:
            # Revoke active sessions for agent roles
            response_actions.append(revoke_agent_sessions(account_id))
        
        # Always notify for high-severity findings
        notification = {
            'finding_type': finding_type,
            'severity': severity,
            'title': title,
            'description': description,
            'actions_taken': response_actions,
            'requires_human_review': True,
        }
        
        sns.publish(
            TopicArn=topic_arn,
            Subject=f'[TDIR] High Severity Finding: {title}',
            Message=json.dumps(notification, indent=2),
        )
        
        print(f"Remediation complete. Actions: {response_actions}")
    else:
        print(f"Finding severity {severity} below threshold {min_severity}. Logging only.")
    
    return {
        'statusCode': 200,
        'finding_type': finding_type,
        'severity': severity,
        'actions_taken': response_actions,
    }


def isolate_agent_runtime(region, account_id):
    """Stop the agent runtime to prevent further compromised actions."""
    try:
        client = boto3.client('bedrock-agentcore', region_name=region)
        # List runtimes and stop any PetFoodAgent runtimes
        runtimes = client.list_agent_runtimes()
        for runtime in runtimes.get('agentRuntimeSummaries', []):
            if 'PetFoodAgent' in runtime.get('agentRuntimeName', ''):
                client.stop_agent_runtime(
                    agentRuntimeId=runtime['agentRuntimeId']
                )
                return f"Stopped agent runtime: {runtime['agentRuntimeId']}"
        return "No active PetFoodAgent runtimes found"
    except Exception as e:
        return f"Agent isolation attempted but failed: {str(e)}"


def revoke_agent_sessions(account_id):
    """Attach a deny-all inline policy to revoke active sessions."""
    try:
        iam = boto3.client('iam')
        # Find agent roles
        paginator = iam.get_paginator('list_roles')
        for page in paginator.paginate(PathPrefix='/'):
            for role in page['Roles']:
                if 'PetFoodAgent' in role['RoleName'] and 'RuntimeRole' in role['RoleName']:
                    deny_policy = json.dumps({
                        "Version": "2012-10-17",
                        "Statement": [{
                            "Effect": "Deny",
                            "Action": "*",
                            "Resource": "*",
                            "Condition": {
                                "DateLessThan": {
                                    "aws:TokenIssueTime": "2099-01-01T00:00:00Z"
                                }
                            }
                        }]
                    })
                    iam.put_role_policy(
                        RoleName=role['RoleName'],
                        PolicyName='SecurityIncidentDenyAll',
                        PolicyDocument=deny_policy,
                    )
                    return f"Revoked sessions for role: {role['RoleName']}"
        return "No agent runtime roles found to revoke"
    except Exception as e:
        return f"Session revocation attempted but failed: {str(e)}"
`),
        });

        // EventBridge rule for high-severity GuardDuty findings
        new Rule(this, 'HighSeverityFindingRule', {
            description: 'Trigger automated remediation for high-severity GuardDuty findings',
            eventPattern: {
                source: ['aws.guardduty'],
                detailType: ['GuardDuty Finding'],
                detail: {
                    severity: [{ numeric: ['>=', minimumSeverity] }],
                },
            } as EventPattern,
            targets: [new LambdaTarget(this.remediationFunction)],
        });

        // EventBridge rule for Security Hub findings (covers GuardDuty + other sources)
        new Rule(this, 'SecurityHubFindingRule', {
            description: 'Trigger remediation for critical Security Hub findings',
            eventPattern: {
                source: ['aws.securityhub'],
                detailType: ['Security Hub Findings - Imported'],
                detail: {
                    findings: {
                        Severity: {
                            Label: ['CRITICAL', 'HIGH'],
                        },
                    },
                },
            } as EventPattern,
            targets: [new LambdaTarget(this.remediationFunction)],
        });

        NagSuppressions.addResourceSuppressions(
            remediationRole,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Remediation role needs broad access to isolate compromised resources',
                },
            ],
            true,
        );
    }
}
