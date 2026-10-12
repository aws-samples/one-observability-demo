/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Locust traffic generator on ECS Fargate.
 *
 * Runs `src/applications/traffic-generator-locust` headless as a long-running service with no
 * load balancer. It drives continuous, session-based user journeys against the PetSite through
 * CloudFront and starts each trace at the simulated user. Spans go over OTLP to a CloudWatch agent
 * sidecar in OTLP mode, which forwards them to X-Ray.
 *
 * Set `CONCURRENT_USERS=0` to run no tasks.
 *
 * @packageDocumentation
 */
import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { Effect, ManagedPolicy, Policy, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { Utilities } from '../utils/utilities';

/** Properties for the traffic generator service. */
export interface TrafficGeneratorProperties extends EcsServiceProperties {
    /** Number of concurrent simulated users */
    concurrentUsers: number;
    /** Waggle AI chats per hour across all users (each chat invokes Bedrock models); 0 disables them */
    waggleChatsPerHour?: number;
}

/** ECS service that runs the Locust traffic generator. */
export class TrafficGeneratorService extends EcsService {
    constructor(scope: Construct, id: string, properties: TrafficGeneratorProperties) {
        const petsiteUrlParameter = `${PARAMETER_STORE_PREFIX}/${SSM_PARAMETER_NAMES.PETSITE_URL}`;

        super(scope, id, {
            ...properties,
            createLoadBalancer: false,
            desiredTaskCount: properties.concurrentUsers > 0 ? properties.desiredTaskCount : 0,
            additionalEnvironment: {
                ...properties.additionalEnvironment,
                PETSITE_URL_PARAMETER_NAME: petsiteUrlParameter,
                LOCUST_USERS: `${Math.max(properties.concurrentUsers, 1)}`,
                LOCUST_SPAWN_RATE: '1',
                WAGGLE_CHATS_PER_HOUR: `${properties.waggleChatsPerHour ?? 4}`,
                OTEL_SERVICE_NAME: 'traffic-generator',
                OTEL_RESOURCE_ATTRIBUTES:
                    'service.namespace=petadoptions,deployment.environment=ecs:PetsiteECS-cluster',
                OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4318/v1/traces',
                OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
                // X-Ray header as well as W3C, so the .NET and Java services join the same trace
                OTEL_PROPAGATORS: 'tracecontext,baggage,xray',
                OTEL_TRACES_SAMPLER: 'parentbased_always_on',
            },
        });

        Utilities.TagConstruct(this, {
            'app:owner': 'petstore',
            'app:project': 'workshop',
            'app:name': properties.name,
            'app:computType': properties.computeType,
            'app:hostType:': properties.hostType,
        });
    }

    addPermissions(properties: TrafficGeneratorProperties): void {
        this.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

        const taskPolicy = new Policy(this, 'taskPolicy', {
            policyName: 'TrafficGeneratorTaskPolicy',
            document: new PolicyDocument({
                statements: [
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: ['ssm:GetParameter'],
                        resources: [
                            `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${PARAMETER_STORE_PREFIX}/${SSM_PARAMETER_NAMES.PETSITE_URL}`,
                        ],
                    }),
                ],
            }),
            roles: [this.taskRole],
        });

        NagSuppressions.addResourceSuppressions(
            this.taskRole,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for the task role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Permissions are acceptable for the task role',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            taskPolicy,
            [{ id: 'AwsSolutions-IAM5', reason: `Read-only access to the ${properties.name} PetSite URL parameter` }],
            true,
        );
    }

    createOutputs(): void {
        // No outputs: the generator has no endpoint
    }
}
