import { Duration, Stack } from 'aws-cdk-lib';
import { Effect, ManagedPolicy, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
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
            environmentVariables: this.getEnvironmentVariables(properties),
            provisionedResourceCleanup: true,
            resourcesToReplicateTags: [ResourceToReplicateTags.LAMBDA_FUNCTION],
            artifactsBucketLifecycleRules: [
                {
                    expiration: Duration.days(properties.logRetentionDays?.valueOf() || 30),
                },
            ],
            timeToLive: Duration.minutes(5),
            startAfterCreation: true,
        });

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
