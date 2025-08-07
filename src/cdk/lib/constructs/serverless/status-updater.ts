/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { WokshopLambdaFunction, WorkshopLambdaFunctionProperties } from '../lambda';
import { Construct } from 'constructs';
import { ManagedPolicy, PolicyDocument, Effect, PolicyStatement, StarPrincipal } from 'aws-cdk-lib/aws-iam';
import { ILayerVersion, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { Arn, Stack } from 'aws-cdk-lib';
import { BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
    EndpointType,
    LambdaRestApi,
    LogGroupLogDestination,
    MethodLoggingLevel,
    RequestAuthorizer,
} from 'aws-cdk-lib/aws-apigateway';
import { NagSuppressions } from 'cdk-nag';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { IVpcEndpoint } from 'aws-cdk-lib/aws-ec2';

export interface StatusUpdaterServiceProperties extends WorkshopLambdaFunctionProperties {
    table: ITable;
    vpcEndpoint?: IVpcEndpoint;
}

export class StatusUpdatedService extends WokshopLambdaFunction {
    public api: LambdaRestApi;
    constructor(scope: Construct, id: string, properties: StatusUpdaterServiceProperties) {
        properties = { ...properties, description: 'Update Pet availability status' };

        super(scope, id, properties);

        const accesLogs = new LogGroup(this, 'access-logs', {
            logGroupName: `/aws/apigw/${properties.name}-api/access-logs`,
            retention: properties.logRetentionDays || RetentionDays.ONE_WEEK,
        });

        const authorizer = new RequestAuthorizer(this, `${properties.name}-authorizer`, {
            handler: this.function,
            identitySources: ['method.request.header.Authorization'],
            resultsCacheTtl: undefined,
            authorizerName: `${properties.name}-authorizer`,
        });

        this.api = new LambdaRestApi(this, `${properties.name}-api`, {
            handler: this.function,
            description: 'Update Pet availability status',
            proxy: true,
            endpointConfiguration: {
                types: [EndpointType.PRIVATE],
            },
            policy: new PolicyDocument({
                statements: [
                    new PolicyStatement({
                        effect: Effect.ALLOW,
                        principals: [new StarPrincipal()],
                        actions: ['execute-api:Invoke'],
                        resources: ['*'],
                        conditions: {
                            StringEquals: {
                                'aws:sourceVpce': properties.vpcEndpoint?.vpcEndpointId || 'vpce-*',
                            },
                        },
                    }),
                ],
            }),
            cloudWatchRole: true,
            deployOptions: {
                tracingEnabled: true,
                loggingLevel: MethodLoggingLevel.INFO,
                stageName: 'prod',
                accessLogDestination: new LogGroupLogDestination(accesLogs),
            },
            defaultMethodOptions: {
                methodResponses: [],
                authorizer: authorizer,
            },
        });

        this.api.addRequestValidator(`${properties.name}-req-validator`, {
            validateRequestBody: true,
            validateRequestParameters: true,
        });

        NagSuppressions.addResourceSuppressions(
            this.api,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Cloudwatch Managed Policy is acceptable for Service Role',
                    appliesTo: [
                        'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs',
                    ],
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            this.api,
            [
                {
                    id: 'AwsSolutions-COG4',
                    reason: 'Private API. Authentication is not required for now as the private zone is considered trusted',
                },
            ],
            true,
        );
    }
    addFunctionPermissions(properties: StatusUpdaterServiceProperties): void {
        if (this.function) {
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName(
                    'arn:aws:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy',
                ),
            );
            this.function.role?.addManagedPolicy(
                ManagedPolicy.fromAwsManagedPolicyName(
                    'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
                ),
            );

            properties.table.grantReadWriteData(this.function);

            NagSuppressions.addResourceSuppressions(
                this.function.role!,
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
    }
    createOutputs(): void {
        // No outputs to create
    }
    getEnvironmentVariables(properties: StatusUpdaterServiceProperties): { [key: string]: string } | undefined {
        // No environment variables to create
        return {
            TABLE_NAME: properties.table.tableName,
        };
    }
    getLayers(): ILayerVersion[] {
        const layerArn = Arn.format({
            account: '580247275435',
            resource: 'layer',
            resourceName: 'LambdaInsightsExtension:21',
            region: Stack.of(this).region,
            service: 'lambda',
            partition: 'aws',
        });

        return [LayerVersion.fromLayerVersionArn(this, 'LambdaInsightsLayer', layerArn)];
    }
    getBundling(): BundlingOptions {
        return {
            externalModules: [
                'aws-sdk', // Use the 'aws-sdk' available in the Lambda runtime
            ],
            nodeModules: ['aws-xray-sdk'],
        };
    }
}
