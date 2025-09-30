import { Duration, Stack } from 'aws-cdk-lib';
import { Effect, ManagedPolicy, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Canary, Code, ResourceToReplicateTags, Runtime, Schedule, Test } from 'aws-cdk-lib/aws-synthetics';
import { Construct } from 'constructs';
import { HOUSEKEEPING_CANARY, PETSITE_CANARY } from '../../bin/environment';
import { NagSuppressions } from 'cdk-nag';

export interface WorkshopCanaryProperties {
    artifactsBucket?: IBucket;
    runtime: Runtime;
    scheduleExpression?: string;
    handler: string;
    path: string;
    logRetentionDays?: RetentionDays;
    name: string;
}

export const CanaryNames = {
    /** Pet status updater function name */
    Petsite: PETSITE_CANARY.name,
    HouseKeeping: HOUSEKEEPING_CANARY.name,
} as const;

export abstract class WorkshopCanary extends Construct {
    public canary: Canary;
    constructor(scope: Construct, id: string, properties: WorkshopCanaryProperties) {
        super(scope, id);

        const canaryRole = this.createLambdaRole(properties);
        properties.artifactsBucket?.grantReadWrite(canaryRole);

        this.canary = new Canary(this, `canary-${id}`, {
            canaryName: properties.name,
            runtime: properties.runtime,
            schedule: Schedule.expression(properties.scheduleExpression || 'rate(5 minutes)'),
            test: Test.custom({
                handler: properties.handler,
                code: Code.fromAsset(properties.path),
            }),
            activeTracing: true,
            artifactsBucketLocation: properties.artifactsBucket
                ? {
                      bucket: properties.artifactsBucket,
                      prefix: `canary-${id}`,
                  }
                : undefined,
            environmentVariables: {
                ...this.getEnvironmentVariables(properties),
                // AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
                // LAMBDA_APPLICATION_SIGNALS_REMOTE_ENVIRONMENT: 'lambda:default',
            },
            provisionedResourceCleanup: true,
            resourcesToReplicateTags: [ResourceToReplicateTags.LAMBDA_FUNCTION],
            artifactsBucketLifecycleRules: [
                {
                    expiration: Duration.days(properties.logRetentionDays?.valueOf() || 30),
                },
            ],
            startAfterCreation: true,
            role: canaryRole,
        });

        // Add Application signals layer
        // const cfnCanary = this.canary.node.defaultChild as CfnCanary;
        // cfnCanary.addPropertyOverride('Code.Dependencies', [
        //     {
        //         Type: 'LambdaLayer',
        //         Reference: getOpenTelemetryNodeJSLayerArn(Stack.of(this).region),
        //     },
        // ]);
        // // Canary role must have access to describe the layer or it will fail
        // cfnCanary.node.addDependency(canaryRole);

        const parameterStorePolicy = new Policy(this, `${id}-paramterstore-policy`, {
            statements: [WorkshopCanary.getDefaultSSMPolicy(this, '/petstore/')],
            roles: [this.canary.role],
        });

        this.canary.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

        NagSuppressions.addResourceSuppressions(
            this.canary.role,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Suppress wildcard permissions created by the Canary Construct',
                },
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'XRay managed polices are acceptable',
                },
            ],
            true,
        );
        NagSuppressions.addResourceSuppressions(
            parameterStorePolicy,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'This allows the canary to read parameters for the application and perform multiple actions',
                    appliesTo: [
                        `Resource::arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/petstore/*`,
                    ],
                },
            ],
            true,
        );
    }

    public static getDefaultSSMPolicy(scope: Construct, prefix?: string) {
        const cleanPrefix = (prefix || '/petstore/').startsWith('/')
            ? (prefix || '/petstore/').slice(1)
            : prefix || '/petstore/';
        const readSMParametersPolicy = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['ssm:GetParametersByPath', 'ssm:GetParameters', 'ssm:GetParameter'],
            resources: [`arn:aws:ssm:${Stack.of(scope).region}:${Stack.of(scope).account}:parameter/${cleanPrefix}*`],
        });

        return readSMParametersPolicy;
    }

    /**
     * Creates IAM role for the Canary
     */
    private createLambdaRole(properties: WorkshopCanaryProperties): Role {
        const managedPolicies = [
            'service-role/AWSLambdaBasicExecutionRole',
            'CloudWatchLambdaApplicationSignalsExecutionRolePolicy',
            'AWSXRayDaemonWriteAccess',
        ];

        const role = new Role(this, 'LambdaRole', {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            description: `Role for ${properties.name} Canary Lambda function`,
            managedPolicies: managedPolicies.map((policy) => ManagedPolicy.fromAwsManagedPolicyName(policy)),
        });

        const metricPolicy = new Policy(this, 'MetricsDataPolicy', {
            roles: [role],
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['cloudwatch:PutMetricData'],
                    resources: ['*'],
                }),
            ],
        });

        NagSuppressions.addResourceSuppressions(
            [metricPolicy],
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'PutMetricData action allowed for simplicity on wildcard',
                },
            ],
            true,
        );
        return role;
    }

    /**
     * Creates CloudFormation outputs for the Lambda function.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     */
    abstract createOutputs(properties: WorkshopCanaryProperties): void;

    /**
     * Returns environment variables for the Lambda function.
     * Must be implemented by concrete subclasses.
     *
     * @param properties - Function configuration properties
     * @returns Map of environment variable names to values
     */
    abstract getEnvironmentVariables(properties: WorkshopCanaryProperties): { [key: string]: string } | undefined;
}
