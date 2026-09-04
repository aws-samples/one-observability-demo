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
 * - Containing the simulated compromised role by attaching a deny-all inline policy
 * - Enumerating the agent runtimes involved, for the incident record
 * - Sending notifications for human review
 *
 * > **Safety**: containment is scoped to the single simulated `AgentEscalatedAccess` role
 * > created by `tdir-escalated-role.ts`. It deliberately cannot touch the real Waggle AI
 * > agent execution roles, so arming it can never take the shared agent demo offline.
 * > `enforce` also defaults to **false**, in which case the Lambda logs and notifies but
 * > mutates nothing. Note the policy it attaches is a *permanent* deny, not a session
 * > revocation: it stays until deleted with `aws iam delete-role-policy`.
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
import { ESCALATED_ROLE_NAME, WORKSHOP_ROLE_PATH } from './tdir-escalated-role';

/**
 * Configuration properties for the TdirRemediation construct.
 */
export interface TdirRemediationProperties {
    /** Minimum severity for triggering automated remediation (default: 7 = High) */
    minimumSeverity?: number;
    /** Log retention period */
    logRetentionDays?: RetentionDays;
    /**
     * Actually mutate IAM when a qualifying finding arrives. Defaults to **false**, i.e.
     * dry-run: the Lambda logs the containment it would perform and publishes to SNS.
     *
     * Leave this false while seeding. GuardDuty sample findings arrive at severity 8, which
     * clears the default threshold of 7, so an armed Lambda contains the role the moment the
     * workshop is seeded rather than when a participant triggers it.
     */
    enforce?: boolean;
    /**
     * Role ARNs the Lambda may contain. Defaults to the simulated `AgentEscalatedAccess`
     * role. Every ARN listed here is granted `iam:PutRolePolicy`, so keep it explicit —
     * never a wildcard.
     */
    containableRoleArns?: string[];
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
        const enforce = props.enforce ?? false;
        const containableRoleArns = props.containableRoleArns ?? [
            `arn:aws:iam::${account}:role${WORKSHOP_ROLE_PATH}${ESCALATED_ROLE_NAME}`,
        ];

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

        // ListAgentRuntimes is a collection-level API: it rejects resource-level scoping and
        // returns AccessDenied against `runtime/*`, so it has to be granted on `*`.
        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['bedrock-agentcore:ListAgentRuntimes'],
                resources: ['*'],
            }),
        );

        // Read-only per-runtime lookup, used to record which runtimes were involved.
        // StopAgentRuntime is deliberately absent: the AgentCore control plane has no such
        // API (Create/Get/List/Update/Delete only). Containment is the deny-all policy below.
        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['bedrock-agentcore:GetAgentRuntime'],
                resources: [`arn:aws:bedrock-agentcore:${region}:${account}:runtime/*`],
            }),
        );

        // Containment, scoped to explicit ARNs. Previously this was
        // `role/*PetFoodAgent*` — an account-wide wildcard paired with a Lambda that
        // enumerated every role in the account. Keep this list explicit.
        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['iam:PutRolePolicy', 'iam:GetRole'],
                resources: containableRoleArns,
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
                REMEDIATION_MODE: enforce ? 'enforce' : 'dry-run',
                CONTAINABLE_ROLE_ARNS: containableRoleArns.join(','),
                AWS_REGION_NAME: region,
            },
            code: Code.fromInline(`
import json
import os

import boto3
import botocore

# The *control* plane. 'bedrock-agentcore' is the data plane (InvokeAgentRuntime) and has
# no List/Get/UpdateAgentRuntime, so calling it raises AttributeError.
CONTROL_SERVICE = 'bedrock-agentcore-control'

CONTAINMENT_POLICY_NAME = 'SecurityIncidentDenyAll'


def revocation_policy():
    '''
    Build the containment policy: Deny * on * conditioned on aws:TokenIssueTime.

    This is the mechanism AWS documents for revoking a role's temporary credentials, used here
    with a deliberately far-future cutoff.

    Why 2099 rather than "now + 30 seconds": the IAM console's Revoke active sessions action
    uses a near-term cutoff, which denies only credentials issued before that moment and lets
    anything assumed afterwards through. That is the right behaviour when you are logging users
    out. It is the wrong behaviour for incident containment, because an attacker holding the
    ability to assume the role simply acquires a fresh session and continues.

    A far-future cutoff makes the condition true for every token that will realistically ever
    be issued, so existing *and* new sessions are denied until the policy is removed. AWS
    documents choosing your own aws:TokenIssueTime value for exactly this kind of control; see
    "Revoke IAM role temporary security credentials" and "Disabling permissions for temporary
    security credentials".

    Verified: with this policy attached, sts:AssumeRole still succeeds - STS is not blocked -
    but every API call made with the resulting credentials fails with AccessDenied.

    Do not change this to a near-term timestamp. It would convert containment into a logout and
    silently let a re-assuming attacker back in.
    '''
    return json.dumps({
        'Version': '2012-10-17',
        'Statement': [{
            'Sid': 'SecurityIncidentContainment',
            'Effect': 'Deny',
            'Action': '*',
            'Resource': '*',
            'Condition': {
                'DateLessThan': {'aws:TokenIssueTime': '2099-01-01T00:00:00Z'},
            },
        }],
    })


def _normalize(event):
    """
    Flatten GuardDuty and Security Hub events into one shape.

    These two sources deliver different structures. Reading only the GuardDuty shape meant
    every Security Hub finding scored 0 and was silently dropped below the threshold.
    """
    detail = event.get('detail', {})

    if 'findings' in detail:
        finding = (detail.get('findings') or [{}])[0]
        severity = finding.get('Severity', {})
        # Security Hub normalizes 0-100; the threshold is on GuardDuty's 0-10 scale.
        normalized = severity.get('Normalized')
        score = (normalized / 10.0) if normalized is not None else 0.0
        return {
            'source': 'securityhub',
            'type': (finding.get('Types') or [''])[0],
            'severity': score,
            'title': finding.get('Title', 'Unknown Finding'),
            'description': finding.get('Description', ''),
            'resources': json.dumps(finding.get('Resources', [])),
        }

    return {
        'source': 'guardduty',
        'type': detail.get('type', ''),
        'severity': float(detail.get('severity') or 0),
        'title': detail.get('title', 'Unknown Finding'),
        'description': detail.get('description', ''),
        'resources': json.dumps(detail.get('resource', {})),
    }


def list_agent_runtimes(region):
    """Every AgentCore runtime in the region, paginated."""
    control = boto3.client(CONTROL_SERVICE, region_name=region)
    runtimes, token = [], None
    while True:
        kwargs = {'nextToken': token} if token else {}
        response = control.list_agent_runtimes(**kwargs)
        # NOT 'agentRuntimeSummaries' - that key does not exist in the response.
        runtimes.extend(response.get('agentRuntimes', []))
        token = response.get('nextToken')
        if not token:
            return runtimes


def record_affected_runtimes(region):
    """
    Note which runtimes exist, for the incident record.

    There is no StopAgentRuntime API, so this is deliberately read-only. Containment happens
    by denying the compromised role, which also preserves the runtime for forensics.
    """
    try:
        runtimes = list_agent_runtimes(region)
    except botocore.exceptions.UnknownServiceError:
        return ['%s unavailable in this runtime boto3' % CONTROL_SERVICE]
    except botocore.exceptions.ClientError as exc:
        return ['ListAgentRuntimes failed: %s' % exc.response['Error']['Code']]

    if not runtimes:
        return ['no AgentCore runtimes found in %s' % region]

    names = [r.get('agentRuntimeName', '<unnamed>') for r in runtimes]
    return ['observed %d agent runtime(s): %s' % (len(names), ', '.join(sorted(names)))]


def contain_roles(enforce):
    """
    Contain each configured role by attaching a deny-all inline policy.

    Scoped to the explicit ARNs in CONTAINABLE_ROLE_ARNS - the Lambda no longer enumerates
    roles, and its IAM policy grants PutRolePolicy on nothing else.

    Denies existing and future sessions for the role: see revocation_policy() for why the
    cutoff is far-future rather than near-term. sts:AssumeRole still succeeds, so the attacker
    can still obtain credentials - they just cannot do anything with them.

    The policy stays attached until removed, and nothing expires it:
        aws iam delete-role-policy --role-name <role> --policy-name SecurityIncidentDenyAll
    """
    arns = [a for a in os.environ.get('CONTAINABLE_ROLE_ARNS', '').split(',') if a]
    if not arns:
        return ['no containable roles configured']

    iam = boto3.client('iam')
    actions = []
    for arn in arns:
        role_name = arn.rsplit('/', 1)[-1]
        if not enforce:
            actions.append('DRY-RUN would attach %s to %s' % (CONTAINMENT_POLICY_NAME, role_name))
            continue
        try:
            iam.put_role_policy(
                RoleName=role_name,
                PolicyName=CONTAINMENT_POLICY_NAME,
                PolicyDocument=revocation_policy(),
            )
            actions.append('contained %s via %s' % (role_name, CONTAINMENT_POLICY_NAME))
        except iam.exceptions.NoSuchEntityException:
            actions.append('role %s not found' % role_name)
        except botocore.exceptions.ClientError as exc:
            actions.append('PutRolePolicy on %s failed: %s' % (role_name, exc.response['Error']['Code']))
    return actions


def handler(event, context):
    """
    Automated remediation for GuardDuty and Security Hub findings.

    - Agent or Bedrock related findings above the threshold: contain the compromised role
      and record the affected runtimes
    - All findings above the threshold: publish to SNS for human review
    """
    print('Received event: %s' % json.dumps(event))

    sns = boto3.client('sns')
    topic_arn = os.environ['SNS_TOPIC_ARN']
    min_severity = float(os.environ.get('MINIMUM_SEVERITY', '7'))
    enforce = os.environ.get('REMEDIATION_MODE') == 'enforce'
    # From the Lambda's own configuration, not the event: Security Hub events carry no
    # top-level region, which previously produced a client with an empty region.
    region = os.environ.get('AWS_REGION_NAME') or os.environ.get('AWS_REGION')

    finding = _normalize(event)
    response_actions = []

    if finding['severity'] < min_severity:
        print('Severity %s below threshold %s. Logging only.' % (finding['severity'], min_severity))
        return {
            'statusCode': 200,
            'source': finding['source'],
            'severity': finding['severity'],
            'actions_taken': [],
        }

    haystack = ' '.join([finding['type'], finding['title'], finding['resources']]).lower()
    agent_related = 'bedrock' in haystack or 'agent' in haystack
    credential_related = 'unauthorizedaccess' in haystack or 'credential' in haystack

    if agent_related:
        response_actions.extend(record_affected_runtimes(region))

    # Called once even when a finding matches both categories, so the incident record does
    # not list the same containment twice.
    if agent_related or credential_related:
        response_actions.extend(contain_roles(enforce))

    notification = {
        'mode': 'enforce' if enforce else 'dry-run',
        'source': finding['source'],
        'finding_type': finding['type'],
        'severity': finding['severity'],
        'title': finding['title'],
        'description': finding['description'],
        'actions_taken': response_actions or ['no automated action matched this finding'],
        'requires_human_review': True,
    }

    sns.publish(
        TopicArn=topic_arn,
        Subject='[TDIR][%s] %s' % ('ENFORCE' if enforce else 'DRY-RUN', finding['title'][:80]),
        Message=json.dumps(notification, indent=2),
    )

    print('Remediation complete. Actions: %s' % response_actions)
    return {
        'statusCode': 200,
        'source': finding['source'],
        'severity': finding['severity'],
        'actions_taken': response_actions,
    }
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
                    reason:
                        'bedrock-agentcore:ListAgentRuntimes is a collection-level API that rejects ' +
                        'resource-level scoping, and GetAgentRuntime is read-only across runtime/*. ' +
                        'The only mutating grant, iam:PutRolePolicy, is scoped to explicit role ARNs.',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(this.remediationFunction, [
            {
                id: 'AwsSolutions-L1',
                reason: 'PYTHON_3_13 is the newest runtime available to this construct; the rule lags new releases',
            },
        ]);
    }
}
