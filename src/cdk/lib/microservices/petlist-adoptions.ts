/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Pet List Adoptions microservice construct (Python/FastAPI on ECS Fargate).
 *
 * Deploys the adoption listing service that queries recent pet adoptions:
 *
 * - **ECS Fargate** with CloudWatch agent sidecar and FireLens log routing
 * - **Aurora PostgreSQL** access for reading adoption transaction history
 * - **ADOT Python auto-instrumentation** via init container (zero-code instrumentation)
 * - **Prometheus metrics** for request count and latency histograms
 * - **Application Signals SLO** support (optional) for availability tracking
 *
 * Includes database load simulation scripts (deadlock, slow query, lock blocking,
 * unique violation simulators) for demonstrating RDS Performance Insights
 * and database observability features.
 *
 * > **Observability highlight**: Demonstrates zero-code Python auto-instrumentation
 * > via ADOT init container — no code changes needed for distributed tracing.
 * > The DB simulation scripts generate observable database performance issues.
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
import { Stack } from 'aws-cdk-lib';
import { CfnServiceLevelObjective } from 'aws-cdk-lib/aws-applicationsignals';

/** Properties for the List Adoptions ECS service, extending base ECS service configuration. */
export interface ListAdoptionsServiceProperties extends EcsServiceProperties {
    /** Aurora PostgreSQL cluster for reading adoption transactions */
    database: IDatabaseCluster;
    /** Secrets Manager secret for database credentials */
    secret: ISecret;
}

/**
 * Pet List Adoptions ECS service (Python/FastAPI).
 *
 * Deploys the adoption listing API with ADOT Python auto-instrumentation
 * (zero-code) via CloudWatch agent sidecar. Includes optional SLO support
 * and Prometheus metrics for request count and latency histograms.
 */
export class ListAdoptionsService extends EcsService {
    constructor(scope: Construct, id: string, properties: ListAdoptionsServiceProperties) {
        const environmentVariables = {
            ...properties.additionalEnvironment,
            PETSTORE_PARAM_PREFIX: PARAMETER_STORE_PREFIX,
            RDS_SECRET_ARN_NAME: SSM_PARAMETER_NAMES.RDS_SECRET_ARN_NAME,
            SEARCH_API_URL_NAME: SSM_PARAMETER_NAMES.SEARCH_API_URL,
            AWS_REGION: Stack.of(scope).region,
        };
        super(scope, id, {
            ...properties,
            additionalEnvironment: environmentVariables,
        });

        // Application Signals with manual instrumentation
        // For ECS custom setup, we manually instrument the app and use CloudWatch agent sidecar
        // as per AWS documentation: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-ECSMain.html
        // ApplicationSignalsIntegration auto-instrumentation doesn't work properly with FastAPI
        // Using enableCloudWatchAgent in applications.ts instead to add the sidecar manually

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

        Utilities.TagConstruct(this, {
            'app:owner': 'petstore',
            'app:project': 'workshop',
            'app:name': properties.name,
            'app:computType': properties.computeType,
            'app:hostType:': properties.hostType,
        });

        if (properties.enableSLO) {
            new CfnServiceLevelObjective(this, 'PetListAdoptionsHealthStatusSLO', {
                name: 'PetListAdoptionsHealthStatusSLO',
                description: 'SLO for GET /health/status endpoint latency <= 5000ms',
                sli: {
                    sliMetric: {
                        keyAttributes: {
                            Type: 'Service',
                            Name: 'petlistadoptions-api-py',
                            Environment: 'ecs:PetsiteECS-cluster',
                        },
                        operationName: 'GET /health/status',
                        metricType: 'LATENCY',
                        periodSeconds: 60,
                    },
                    metricThreshold: 5000,
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
    }

    addPermissions(properties: ListAdoptionsServiceProperties): void {
        properties.secret?.grantRead(this.taskRole);

        this.taskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        );

        this.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

        const taskPolicy = new Policy(this, 'taskPolicy', {
            policyName: 'ListdoptionTaskPolicy',
            document: new PolicyDocument({
                statements: [EcsService.getDefaultSSMPolicy(this, PARAMETER_STORE_PREFIX)],
            }),
            roles: [this.taskRole],
        });

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

    createOutputs(properties: ListAdoptionsServiceProperties): void {
        if (!this.loadBalancedService && !properties.disableService) {
            throw new Error('Service is not defined');
        } else {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.PET_LIST_ADOPTIONS_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/api/adoptionlist/`,
                        [SSM_PARAMETER_NAMES.PET_LIST_ADOPTIONS_METRICS_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/metrics`,
                    }),
                ),
            );
        }
    }
}
