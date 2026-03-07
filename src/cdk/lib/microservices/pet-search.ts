/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Pet Search microservice construct (Java/Spring Boot on ECS Fargate).
 *
 * Deploys the pet search service that queries the DynamoDB pet catalog:
 *
 * - **ECS Fargate** with CloudWatch agent sidecar and FireLens log routing
 * - **DynamoDB** access for pet catalog search with scan filters
 * - **S3** access for pet image URL resolution
 * - **Application Signals** integration via `@aws-cdk/aws-applicationsignals-alpha`
 * - **Java auto-instrumentation** with configurable instrumentation version
 *
 * Two instrumentation variants exist in the source code:
 * - `petsearch-java/` — Auto-instrumented via ADOT Java agent
 * - `petsearch-java/manual-instrumentation-complete/` — Manual OpenTelemetry SDK instrumentation
 *
 * > **Observability highlight**: Demonstrates the contrast between auto and manual
 * > Java instrumentation. The auto-instrumented version requires zero code changes,
 * > while the manual version shows custom spans, metrics, and trace context propagation.
 *
 * @packageDocumentation
 */
import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ManagedPolicy, Policy, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { ApplicationSignalsIntegration, JavaInstrumentationVersion } from '@aws-cdk/aws-applicationsignals-alpha';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Stack } from 'aws-cdk-lib';
import { CfnServiceLevelObjective } from 'aws-cdk-lib/aws-applicationsignals';

/** Properties for the Pet Search ECS service, extending base ECS service configuration. */
export interface PetSearchServiceProperties extends EcsServiceProperties {
    /** Aurora PostgreSQL cluster (used for legacy data access) */
    database: IDatabaseCluster;
    /** Secrets Manager secret for database credentials */
    secret: ISecret;
    /** DynamoDB table for pet catalog lookups */
    table: ITable;
    /** S3 bucket for pet image assets */
    bucket: IBucket;
}

/**
 * Pet Search ECS service (Java/Spring Boot).
 *
 * Deploys the pet search API with Application Signals auto-instrumentation
 * via the `@aws-cdk/aws-applicationsignals-alpha` L2 construct. Includes
 * optional SLO configuration for availability and latency tracking.
 */
export class PetSearchService extends EcsService {
    constructor(scope: Construct, id: string, properties: PetSearchServiceProperties) {
        // Add environment variables for configurable SSM parameter names
        const environmentVariables = {
            ...properties.additionalEnvironment,
            PETSEARCH_PARAM_PREFIX: PARAMETER_STORE_PREFIX,
            PETSEARCH_IMAGES_CDN_URL: SSM_PARAMETER_NAMES.IMAGES_CDN_URL,
            PETSEARCH_S3_BUCKET_NAME: SSM_PARAMETER_NAMES.S3_BUCKET_NAME,
            PETSEARCH_DYNAMODB_TABLE_NAME: SSM_PARAMETER_NAMES.DYNAMODB_TABLE_NAME,
            AWS_REGION: Stack.of(scope).region,
            AWS_PAGER: '',
        };

        super(scope, id, {
            ...properties,
            additionalEnvironment: environmentVariables,
        });
        Utilities.TagConstruct(this, {
            'app:owner': 'petstore',
            'app:project': 'workshop',
            'app:name': properties.name,
            'app:computType': properties.computeType,
            'app:hostType:': properties.hostType,
        });

        new ApplicationSignalsIntegration(this, 'petsearch-integration', {
            taskDefinition: this.taskDefinition,
            instrumentation: {
                sdkVersion: JavaInstrumentationVersion.V2_10_0,
            },
            serviceName: 'petsearch-api-java',
            cloudWatchAgentSidecar: {
                containerName: 'ecs-cwagent',
                enableLogging: true,
                cpu: 256,
                memoryLimitMiB: 512,
            },
        });

        if (properties.enableSLO) {
            new CfnServiceLevelObjective(this, 'PetSearchApiSearchSLO', {
                name: 'PetSearchApiSearchSLO',
                description: 'SLO for /api/search GET endpoint latency <= 8000ms',
                sli: {
                    sliMetric: {
                        keyAttributes: {
                            Type: 'Service',
                            Name: 'petsearch-api-java',
                            Environment: 'ecs:PetsiteECS-cluster',
                        },
                        operationName: 'GET /api/search',
                        metricType: 'LATENCY',
                        periodSeconds: 60,
                    },
                    metricThreshold: 8000,
                    comparisonOperator: 'LessThan',
                },
                goal: {
                    interval: {
                        rollingInterval: {
                            duration: 1,
                            durationUnit: 'DAY',
                        },
                    },
                    attainmentGoal: 90,
                },
            });
        }

        NagSuppressions.addResourceSuppressions(
            this.taskDefinition,
            [
                {
                    id: 'AwsSolutions-ECS7',
                    reason: 'False positive, the Application Signal container has logging enabled as a sidecar',
                },
                {
                    id: 'Workshop-CWL1',
                    reason: 'Cloudwatch Logs is not an exposed property for the Alpha',
                },
                {
                    id: 'Workshop-CWL2',
                    reason: 'Cloudwatch Logs is not an exposed property for the Alpha',
                },
            ],
            true,
        );
    }

    addPermissions(properties: PetSearchServiceProperties): void {
        this.taskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        );

        this.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

        const taskPolicy = new Policy(this, 'taskPolicy', {
            policyName: 'PetSearchTaskPolicy',
            document: new PolicyDocument({
                statements: [EcsService.getDefaultSSMPolicy(this, PARAMETER_STORE_PREFIX)],
            }),
            roles: [this.taskRole],
        });

        properties.table.grantReadData(this.taskRole);
        properties.bucket.grantRead(this.taskRole);

        NagSuppressions.addResourceSuppressions(
            taskPolicy,
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
    }

    createOutputs(properties: PetSearchServiceProperties): void {
        if (!this.loadBalancedService && !properties.disableService) {
            throw new Error('Service is not defined');
        } else {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.SEARCH_API_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/api/search?`,
                    }),
                ),
            );
        }
    }
}
