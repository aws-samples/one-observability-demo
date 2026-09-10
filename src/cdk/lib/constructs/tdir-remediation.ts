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
 * Remediation acts on all three planes an agent workload can be contained on:
 * - **Identity** — deny-all inline policy on the simulated compromised role, so the
 *   credentials it holds stop working
 * - **Resource** — deny-invoke resource policy on the named agent runtimes, so no caller
 *   can reach them
 * - **Session** — `StopRuntimeSession` for an in-flight session, when the finding names one
 * - Plus an SNS notification for human review
 *
 * > **Why there is no "stop the runtime" step.** AgentCore has no StopAgentRuntime, Pause or
 * > Disable API: the control plane offers only Create/Get/List/Update/Delete, and
 * > `AgentRuntimeStatus` is `CREATING | CREATE_FAILED | UPDATING | UPDATE_FAILED | READY |
 * > DELETING` — there is no `STOPPED` value and no `ACTIVE` value. A contained runtime
 * > therefore still reports `READY`, and isolation has to be enforced on the *access path*
 * > rather than the compute state. That is also the outcome you want during an incident: the
 * > runtime keeps its logs, traces and memory available for forensics while nothing new can
 * > invoke it. Verify containment with `get-resource-policy`, never with `status`.
 *
 * > **Safety**: every mutating action is scoped to an explicit allowlist — role ARNs in
 * > `containableRoleArns` (default: the simulated `AgentEscalatedAccess` role) and runtime
 * > names in `containableRuntimeNames`. The Lambda never contains "every runtime it finds":
 * > that would take the shared Waggle AI demo offline, and this Lambda fires on GuardDuty
 * > sample findings. `enforce` also defaults to **false**, in which case the Lambda logs and
 * > notifies but mutates nothing.
 *
 * > Neither containment expires. Lift them with `aws iam delete-role-policy` and
 * > `aws bedrock-agentcore-control delete-resource-policy` respectively.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { stableCfnOutput } from '../utils/stable-output';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { Runtime, Function as LambdaFunction, Code } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Role, ServicePrincipal, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Rule, EventPattern } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaTarget } from 'aws-cdk-lib/aws-events-targets';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { NagSuppressions } from 'cdk-nag';
import { ESCALATED_ROLE_NAME, WORKSHOP_ROLE_PATH } from './tdir-escalated-role';

/**
 * The runtime the workshop narrative treats as compromised, and therefore the only one
 * containment isolates by default. Must match the `--runtime-name` default in
 * `scripts/tdir-seed-scenarios.py`, which plants the evidence against the same runtime.
 */
export const COMPROMISED_RUNTIME_NAME = 'WaggleAIOrchestrator';

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
    /**
     * Names of the AgentCore runtimes the Lambda may isolate with a deny-invoke resource
     * policy. Defaults to the single runtime the workshop narrative compromises.
     *
     * Matched by exact name against `ListAgentRuntimes`, never applied to every runtime
     * returned — containing all five Waggle AI agents would take the shared chat demo offline.
     */
    containableRuntimeNames?: string[];
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

        const minimumSeverity = properties?.minimumSeverity || 7;
        const retention = properties?.logRetentionDays || RetentionDays.ONE_WEEK;
        const region = Stack.of(this).region;
        const account = Stack.of(this).account;
        const enforce = properties?.enforce ?? false;
        const containableRoleArns = properties?.containableRoleArns ?? [
            `arn:aws:iam::${account}:role${WORKSHOP_ROLE_PATH}${ESCALATED_ROLE_NAME}`,
        ];
        const containableRuntimeNames = properties?.containableRuntimeNames ?? [COMPROMISED_RUNTIME_NAME];

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

        // Runtime-side containment. StopAgentRuntime is absent because no such API exists —
        // the control plane offers only Create/Get/List/Update/Delete — so isolation is a
        // deny-invoke resource policy plus, where a live session is named, StopRuntimeSession.
        //
        // These are scoped to `runtime/*` rather than to the named runtime because the ARN
        // suffix is a service-generated 10-character id that is not known at synth time. The
        // Lambda's own allowlist (CONTAINABLE_RUNTIME_NAMES) is what narrows it to one runtime.
        // `runtime/*` also covers endpoint ARNs, which are nested as
        // `runtime/<id>/runtime-endpoint/<name>`.
        remediationRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: [
                    'bedrock-agentcore:GetAgentRuntime',
                    'bedrock-agentcore:PutResourcePolicy',
                    'bedrock-agentcore:GetResourcePolicy',
                    'bedrock-agentcore:StopRuntimeSession',
                ],
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
                CONTAINABLE_RUNTIME_NAMES: containableRuntimeNames.join(','),
                AWS_REGION_NAME: region,
            },
            code: Code.fromInline(`
import json
import os

import boto3
import botocore

# The *control* plane, for ListAgentRuntimes / PutResourcePolicy. 'bedrock-agentcore' is the
# data plane and has no List/Get/UpdateAgentRuntime, so calling it raises AttributeError.
CONTROL_SERVICE = 'bedrock-agentcore-control'

# The *data* plane, which is where StopRuntimeSession lives - not the control plane. Looking
# only at the control plane is what previously led to "there is no way to stop anything".
DATA_SERVICE = 'bedrock-agentcore'

CONTAINMENT_POLICY_NAME = 'SecurityIncidentDenyAll'

RUNTIME_POLICY_SID = 'SecurityIncidentDenyInvoke'

# Keys whose value is a runtime session id. Matched on the key name rather than by pattern:
# scanning the whole event for any long token would also match finding ids, request ids and
# base64 blobs, and a false positive here means calling StopRuntimeSession on something that
# was never part of the incident.
SESSION_ID_KEYS = ('runtimesessionid', 'sessionid', 'session_id')

# StopRuntimeSession constrains runtimeSessionId to 33-256 characters. Anything shorter is
# rejected by the service before it is even looked up, so short ids are filtered out rather
# than sent. Note the seeded narrative's 'session-<12 hex>' ids are 20 characters and are
# fabricated log entries, not live sessions - they will never be stoppable.
SESSION_ID_MIN, SESSION_ID_MAX = 33, 256


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


def runtime_deny_policy(runtime_arn):
    '''
    Resource-based policy denying every principal the ability to invoke the runtime.

    This is the runtime-side half of containment, and the reason the workshop can isolate an
    agent at all. AgentCore has no StopAgentRuntime, Pause or Disable API, and
    AgentRuntimeStatus has no STOPPED value - so a contained runtime still reports READY and
    isolation must be enforced on the access path instead of the compute state.

    PutResourcePolicy is documented as supported for AgentCore Runtime and Gateway. An explicit
    Deny in a resource-based policy overrides any identity-based Allow, so this blocks
    invocation for every caller, including the account root.

    Resource is a single ARN, and must be. AgentCore rejects anything else with
    "Policy statement block must contain exactly one resource ARN that matches the provided
    resource ARN" - so a list, or an added <arn>/runtime-endpoint/* entry, fails validation.

    That restriction is not a gap: InvokeAgentRuntime is authorized against the *runtime* ARN
    whatever qualifier is used. Verified against a live runtime - invocation is denied with the
    DEFAULT endpoint, with an explicitly named custom endpoint, on a brand-new session and on a
    session established before the policy was attached.

    The runtime keeps running on purpose. Its logs, traces and memory stay available for
    forensics while nothing new can reach it.

    Reversible, and the workshop asks participants to reverse it:
        aws bedrock-agentcore-control delete-resource-policy --resource-arn <runtime arn>
    '''
    return json.dumps({
        'Version': '2012-10-17',
        'Statement': [{
            'Sid': RUNTIME_POLICY_SID,
            'Effect': 'Deny',
            'Principal': '*',
            'Action': ['bedrock-agentcore:InvokeAgentRuntime'],
            'Resource': runtime_arn,
        }],
    })


def _session_ids(event):
    """
    Session ids named by the finding, filtered to those the service will accept.

    There is no API that lists a runtime's live sessions: bedrock-agentcore:ListSessions is
    Memory-scoped and requires a memoryId plus an actorId, not a runtime ARN. So a session can
    only be stopped if the finding carries its id, and a finding that carries none means no
    session gets stopped - which is reported rather than glossed over.

    Walks the event for keys named like a session id, at any depth, because GuardDuty and
    Security Hub nest their details differently and Security Hub buries custom fields under
    Resources[].Details.Other.
    """
    found = []

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(value, str) and key.lower() in SESSION_ID_KEYS:
                    if SESSION_ID_MIN <= len(value) <= SESSION_ID_MAX and value not in found:
                        found.append(value)
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(event)
    return found


def contain_agent_runtimes(region, event, enforce):
    """
    Isolate the named runtimes: deny invocation, then stop any live session named.

    Matched by exact name against CONTAINABLE_RUNTIME_NAMES. Deliberately not applied to every
    runtime ListAgentRuntimes returns - containing all five Waggle AI agents would take the
    shared chat demo offline, and this Lambda fires on GuardDuty sample findings.
    """
    targets = [n for n in os.environ.get('CONTAINABLE_RUNTIME_NAMES', '').split(',') if n]
    if not targets:
        return ['no containable runtimes configured']

    try:
        runtimes = list_agent_runtimes(region)
    except botocore.exceptions.UnknownServiceError:
        return ['%s unavailable in this runtime boto3' % CONTROL_SERVICE]
    except botocore.exceptions.ClientError as exc:
        return ['ListAgentRuntimes failed: %s' % exc.response['Error']['Code']]

    if not runtimes:
        return ['no AgentCore runtimes found in %s' % region]

    matched = [r for r in runtimes if r.get('agentRuntimeName') in targets]
    actions = [
        'observed %d agent runtime(s); %d matched the containment allowlist'
        % (len(runtimes), len(matched))
    ]
    if not matched:
        return actions

    control = boto3.client(CONTROL_SERVICE, region_name=region)
    data = boto3.client(DATA_SERVICE, region_name=region)
    session_ids = _session_ids(event)

    for runtime in matched:
        name = runtime.get('agentRuntimeName', '<unnamed>')
        arn = runtime.get('agentRuntimeArn')
        if not arn:
            actions.append('runtime %s carries no ARN in the ListAgentRuntimes response' % name)
            continue

        if not enforce:
            actions.append('DRY-RUN would deny bedrock-agentcore:InvokeAgentRuntime on %s' % name)
        else:
            try:
                control.put_resource_policy(resourceArn=arn, policy=runtime_deny_policy(arn))
                actions.append('isolated %s: InvokeAgentRuntime denied by resource policy' % name)
            except botocore.exceptions.ClientError as exc:
                actions.append(
                    'PutResourcePolicy on %s failed: %s' % (name, exc.response['Error']['Code'])
                )

        if not session_ids:
            actions.append('no live session id in the finding, so no session stopped on %s' % name)
            continue
        for session_id in session_ids:
            if not enforce:
                actions.append('DRY-RUN would stop session %s on %s' % (session_id, name))
                continue
            try:
                data.stop_runtime_session(agentRuntimeArn=arn, runtimeSessionId=session_id)
                actions.append('stopped session %s on %s' % (session_id, name))
            except botocore.exceptions.ClientError as exc:
                # ResourceNotFoundException is the normal outcome for a session that has
                # already ended, or for a fabricated id from seeded evidence.
                actions.append(
                    'StopRuntimeSession %s on %s: %s'
                    % (session_id, name, exc.response['Error']['Code'])
                )
    return actions


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

    - Agent or Bedrock related findings above the threshold: isolate the named agent runtimes
      (deny-invoke resource policy, plus StopRuntimeSession for any live session the finding
      names) and contain the compromised role
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
        response_actions.extend(contain_agent_runtimes(region, event, enforce))

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

        // Participants read these with `aws ssm get-parameter` rather than from CloudFormation,
        // matching how the observability workshop surfaces environment-specific values.
        Utilities.createSsmParameters(
            this,
            PARAMETER_STORE_PREFIX,
            new Map([
                ['tdir/remediationfunctionname', this.remediationFunction.functionName],
                ['tdir/remediationtopicarn', this.notificationTopic.topicArn],
                ['tdir/remediationloggroup', logGroup.logGroupName],
                ['tdir/remediationmode', enforce ? 'enforce' : 'dry-run'],
            ]),
        );

        // Published so the workshop guide can name these by output rather than by string
        // match. Searching the console for "SecurityNotifications" returns more than one
        // topic in a full deployment, and the Lambda's generated name is unguessable — both
        // of which the guide previously worked around with instructions that went stale.
        stableCfnOutput(this, 'TdirRemediationTopicArn', {
            value: this.notificationTopic.topicArn,
            description: 'SNS topic the remediation Lambda publishes incident records to',
        });
        stableCfnOutput(this, 'TdirRemediationFunctionName', {
            value: this.remediationFunction.functionName,
            description: 'Remediation Lambda to inspect in the console',
        });
        stableCfnOutput(this, 'TdirRemediationLogGroup', {
            value: logGroup.logGroupName,
            description: 'Log group holding the remediation Lambda decisions',
        });
        stableCfnOutput(this, 'TdirRemediationMode', {
            value: enforce ? 'enforce' : 'dry-run',
            description: 'Whether remediation mutates IAM, or only logs and notifies',
        });

        NagSuppressions.addResourceSuppressions(
            remediationRole,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason:
                        'bedrock-agentcore:ListAgentRuntimes is a collection-level API that rejects ' +
                        'resource-level scoping. The runtime grants use runtime/* because the ARN ' +
                        'suffix is a service-generated id unknown at synth time, and because endpoint ' +
                        'ARNs are nested under it; the Lambda narrows them to an explicit name ' +
                        'allowlist at run time. iam:PutRolePolicy is scoped to explicit role ARNs.',
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
