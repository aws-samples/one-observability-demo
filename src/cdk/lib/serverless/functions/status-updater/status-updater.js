"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusUpdatedService = void 0;
const lambda_1 = require("../../../constructs/lambda");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_apigateway_1 = require("aws-cdk-lib/aws-apigateway");
const cdk_nag_1 = require("cdk-nag");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const utilities_1 = require("../../../utils/utilities");
const environment_1 = require("../../../../bin/environment");
class StatusUpdatedService extends lambda_1.WokshopLambdaFunction {
    constructor(scope, id, properties) {
        properties = { ...properties, description: 'Update Pet availability status' };
        super(scope, id, properties);
        const accesLogs = new aws_logs_1.LogGroup(this, 'access-logs', {
            logGroupName: `/aws/apigw/${properties.name}-api/access-logs`,
            retention: properties.logRetentionDays || aws_logs_1.RetentionDays.ONE_WEEK,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        const authorizer = new aws_apigateway_1.RequestAuthorizer(this, `${properties.name}-authorizer`, {
            handler: this.function,
            identitySources: ['method.request.header.Authorization'],
            resultsCacheTtl: undefined,
            authorizerName: `${properties.name}-authorizer`,
        });
        this.api = new aws_apigateway_1.LambdaRestApi(this, `${properties.name}-api`, {
            handler: this.function,
            description: 'Update Pet availability status',
            proxy: true,
            endpointConfiguration: {
                types: [aws_apigateway_1.EndpointType.PRIVATE],
            },
            policy: new aws_iam_1.PolicyDocument({
                statements: [
                    new aws_iam_1.PolicyStatement({
                        effect: aws_iam_1.Effect.ALLOW,
                        principals: [new aws_iam_1.StarPrincipal()],
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
                loggingLevel: aws_apigateway_1.MethodLoggingLevel.INFO,
                stageName: 'prod',
                accessLogDestination: new aws_apigateway_1.LogGroupLogDestination(accesLogs),
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
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.api, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Cloudwatch Managed Policy is acceptable for Service Role',
                appliesTo: [
                    'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs',
                ],
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.api, [
            {
                id: 'AwsSolutions-COG4',
                reason: 'Private API. Authentication is not required for now as the private zone is considered trusted',
            },
        ], true);
        this.createOutputs();
    }
    addFunctionPermissions(properties) {
        if (this.function) {
            this.function.role?.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy'));
            this.function.role?.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
            properties.table.grantReadWriteData(this.function);
            cdk_nag_1.NagSuppressions.addResourceSuppressions(this.function.role, [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for the task role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Permissions are acceptable for the task role',
                },
            ], true);
        }
    }
    createOutputs() {
        if (this.api) {
            utilities_1.Utilities.createSsmParameters(this, environment_1.PARAMETER_STORE_PREFIX, new Map(Object.entries({
                updateadoptionstatusurl: this.api.url,
            })));
        }
        else {
            throw new Error('Service is not defined');
        }
    }
    getEnvironmentVariables(properties) {
        // No environment variables to create
        return {
            TABLE_NAME: properties.table.tableName,
        };
    }
    getLayers() {
        return [
            aws_lambda_1.LayerVersion.fromLayerVersionArn(this, 'LambdaInsightsLayer', (0, lambda_1.getLambdaInsightsLayerArn)(aws_cdk_lib_1.Stack.of(this).region)),
        ];
    }
    getBundling() {
        return {
            externalModules: [],
            nodeModules: ['aws-xray-sdk-core', '@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
        };
    }
}
exports.StatusUpdatedService = StatusUpdatedService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdHVzLXVwZGF0ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzdGF0dXMtdXBkYXRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFLQSx1REFJb0M7QUFFcEMsaURBQTRHO0FBQzVHLHVEQUFxRTtBQUNyRSw2Q0FBbUQ7QUFFbkQsK0RBTW9DO0FBQ3BDLHFDQUEwQztBQUMxQyxtREFBK0Q7QUFFL0Qsd0RBQXFEO0FBQ3JELDZEQUFxRTtBQU9yRSxNQUFhLG9CQUFxQixTQUFRLDhCQUFxQjtJQUUzRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFVBQTBDO1FBQ2hGLFVBQVUsR0FBRyxFQUFFLEdBQUcsVUFBVSxFQUFFLFdBQVcsRUFBRSxnQ0FBZ0MsRUFBRSxDQUFDO1FBRTlFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRTdCLE1BQU0sU0FBUyxHQUFHLElBQUksbUJBQVEsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ2hELFlBQVksRUFBRSxjQUFjLFVBQVUsQ0FBQyxJQUFJLGtCQUFrQjtZQUM3RCxTQUFTLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixJQUFJLHdCQUFhLENBQUMsUUFBUTtZQUNoRSxhQUFhLEVBQUUsMkJBQWEsQ0FBQyxPQUFPO1NBQ3ZDLENBQUMsQ0FBQztRQUVILE1BQU0sVUFBVSxHQUFHLElBQUksa0NBQWlCLENBQUMsSUFBSSxFQUFFLEdBQUcsVUFBVSxDQUFDLElBQUksYUFBYSxFQUFFO1lBQzVFLE9BQU8sRUFBRSxJQUFJLENBQUMsUUFBUTtZQUN0QixlQUFlLEVBQUUsQ0FBQyxxQ0FBcUMsQ0FBQztZQUN4RCxlQUFlLEVBQUUsU0FBUztZQUMxQixjQUFjLEVBQUUsR0FBRyxVQUFVLENBQUMsSUFBSSxhQUFhO1NBQ2xELENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSw4QkFBYSxDQUFDLElBQUksRUFBRSxHQUFHLFVBQVUsQ0FBQyxJ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QUFTLENBQUMsbUJBQW1CLENBQ3pCLElBQUksRUFDSixvQ0FBc0IsRUFDdEIsSUFBSSxHQUFHLENBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQztnQkFDWCx1QkFBdUIsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUc7YUFDeEMsQ0FBQyxDQUNMLENBQ0osQ0FBQztRQUNOLENBQUM7YUFBTSxDQUFDO1lBQ0osTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO1FBQzlDLENBQUM7SUFDTCxDQUFDO0lBQ0QsdUJBQXVCLENBQUMsVUFBMEM7UUFDOUQscUNBQXFDO1FBQ3JDLE9BQU87WUFDSCxVQUFVLEVBQUUsVUFBVSxDQUFDLEtBQUssQ0FBQyxTQUFTO1NBQ3pDLENBQUM7SUFDTixDQUFDO0lBQ0QsU0FBUztRQUNMLE9BQU87WUFDSCx5QkFBWSxDQUFDLG1CQUFtQixDQUM1QixJQUFJLEVBQ0oscUJBQXFCLEVBQ3JCLElBQUEsa0NBQXlCLEVBQUMsbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQ25EO1NBQ0osQ0FBQztJQUNOLENBQUM7SUFDRCxXQUFXO1FBQ1AsT0FBTztZQUNILGVBQWUsRUFBRSxFQUFFO1lBQ25CLFdBQVcsRUFBRSxDQUFDLG1CQUFtQixFQUFFLDBCQUEwQixFQUFFLHVCQUF1QixDQUFDO1NBQzFGLENBQUM7SUFDTixDQUFDO0NBQ0o7QUF0SkQsb0RBc0pDIiwic291cmNlc0NvbnRlbnQiOlsiLypcbkNvcHlyaWdodCBBbWF6b24uY29tLCBJbmMuIG9yIGl0cyBhZmZpbGlhdGVzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiovXG5pbXBvcnQgeyBJVGFibGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0IHtcbiAgICBXb2tzaG9wTGFtYmRhRnVuY3Rpb24sXG4gICAgV29ya3Nob3BMYW1iZGFGdW5jdGlvblByb3BlcnRpZXMsXG4gICAgZ2V0TGFtYmRhSW5zaWdodHNMYXllckFybixcbn0gZnJvbSAnLi4vLi4vLi4vY29uc3RydWN0cy9sYW1iZGEnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBNYW5hZ2VkUG9saWN5LCBQb2xpY3lEb2N1bWVudCwgRWZmZWN0LCBQb2xpY3lTdGF0ZW1lbnQsIFN0YXJQcmluY2lwYWwgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IElMYXllclZlcnNpb24sIExheWVyVmVyc2lvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBCdW5kbGluZ09wdGlvbnMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQge1xuICAgIEVuZHBvaW50VHlwZSxcbiAgICBMYW1iZGFSZXN0QXBpLFxuICAgIExvZ0dyb3VwTG9nRGVzdGluYXRpb24sXG4gICAgTWV0aG9kTG9nZ2luZ0xldmVsLFxuICAgIFJlcXVlc3RBdXRob3JpemVyLFxufSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcbmltcG9ydCB7IExvZ0dyb3VwLCBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgSVZwY0VuZHBvaW50IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBVdGlsaXRpZXMgfSBmcm9tICcuLi8uLi8uLi91dGlscy91dGlsaXRpZXMnO1xuaW1wb3J0IHsgUEFSQU1FVEVSX1NUT1JFX1BSRUZJWCB9IGZyb20gJy4uLy4uLy4uLy4uL2Jpbi9lbnZpcm9ubWVudCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzVXBkYXRlclNlcnZpY2VQcm9wZXJ0aWVzIGV4dGVuZHMgV29ya3Nob3BMYW1iZGFGdW5jdGlvblByb3BlcnRpZXMge1xuICAgIHRhYmxlOiBJVGFibGU7XG4gICAgdnBjRW5kcG9pbnQ/OiBJVnBjRW5kcG9pbnQ7XG59XG5cbmV4cG9ydCBjbGFzcyBTdGF0dXNVcGRhdGVkU2VydmljZSBleHRlbmRzIFdva3Nob3BMYW1iZGFGdW5jdGlvbiB7XG4gICAgcHVibGljIGFwaTogTGFtYmRhUmVzdEFwaTtcbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBTdGF0dXNVcGRhdGVyU2VydmljZVByb3BlcnRpZXMpIHtcbiAgICAgICAgcHJvcGVydGllcyA9IHsgLi4ucHJvcGVydGllcywgZGVzY3JpcHRpb246ICdVcGRhdGUgUGV0IGF2YWlsYWJpbGl0eSBzdGF0dXMnIH07XG5cbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wZXJ0aWVzKTtcblxuICAgICAgICBjb25zdCBhY2Nlc0xvZ3MgPSBuZXcgTG9nR3JvdXAodGhpcywgJ2FjY2Vzcy1sb2dzJywge1xuICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9hcGlndy8ke3Byb3BlcnRpZXMubmFtZX0tYXBpL2FjY2Vzcy1sb2dzYCxcbiAgICAgICAgICAgIHJldGVudGlvbjogcHJvcGVydGllcy5sb2dSZXRlbnRpb25EYXlzIHx8IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IGF1dGhvcml6ZXIgPSBuZXcgUmVxdWVzdEF1dGhvcml6ZXIodGhpcywgYCR7cHJvcGVydGllcy5uYW1lfS1hdXRob3JpemVyYCwge1xuICAgICAgICAgICAgaGFuZGxlcjogdGhpcy5mdW5jdGlvbixcbiAgICAgICAgICAgIGlkZW50aXR5U291cmNlczogWydtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbiddLFxuICAgICAgICAgICAgcmVzdWx0c0NhY2hlVHRsOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBhdXRob3JpemVyTmFtZTogYCR7cHJvcGVydGllcy5uYW1lfS1hdXRob3JpemVyYCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5hcGkgPSBuZXcgTGFtYmRhUmVzdEFwaSh0aGlzLCBgJHtwcm9wZXJ0aWVzLm5hbWV9LWFwaWAsIHtcbiAgICAgICAgICAgIGhhbmRsZXI6IHRoaXMuZnVuY3Rpb24sXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1VwZGF0ZSBQZXQgYXZhaWxhYmlsaXR5IHN0YXR1cycsXG4gICAgICAgICAgICBwcm94eTogdHJ1ZSxcbiAgICAgICAgICAgIGVuZHBvaW50Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgICAgIHR5cGVzOiBbRW5kcG9pbnRUeXBlLlBSSVZBVEVdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHBvbGljeTogbmV3IFBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgICAgICAgICBwcmluY2lwYWxzOiBbbmV3IFN0YXJQcmluY2lwYWwoKV0sXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2V4ZWN1dGUtYXBpOkludm9rZSddLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2F3czpzb3VyY2VWcGNlJzogcHJvcGVydGllcy52cGNFbmRwb2ludD8udnBjRW5kcG9pbnRJZCB8fCAndnBjZS0qJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgY2xvdWRXYXRjaFJvbGU6IHRydWUsXG4gICAgICAgICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgICAgICAgICAgdHJhY2luZ0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgICAgbG9nZ2luZ0xldmVsOiBNZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJyxcbiAgICAgICAgICAgICAgICBhY2Nlc3NMb2dEZXN0aW5hdGlvbjogbmV3IExvZ0dyb3VwTG9nRGVzdGluYXRpb24oYWNjZXNMb2dzKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZWZhdWx0TWV0aG9kT3B0aW9uczoge1xuICAgICAgICAgICAgICAgIG1ldGhvZFJlc3BvbnNlczogW10sXG4gICAgICAgICAgICAgICAgYXV0aG9yaXplcjogYXV0aG9yaXplcixcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuYXBpLmFkZFJlcXVlc3RWYWxpZGF0b3IoYCR7cHJvcGVydGllcy5uYW1lfS1yZXEtdmFsaWRhdG9yYCwge1xuICAgICAgICAgICAgdmFsaWRhdGVSZXF1ZXN0Qm9keTogdHJ1ZSxcbiAgICAgICAgICAgIHZhbGlkYXRlUmVxdWVzdFBhcmFtZXRlcnM6IHRydWUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIHRoaXMuYXBpLFxuICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0Nsb3Vkd2F0Y2ggTWFuYWdlZCBQb2xpY3kgaXMgYWNjZXB0YWJsZSBmb3IgU2VydmljZSBSb2xlJyxcbiAgICAgICAgICAgICAgICAgICAgYXBwbGllc1RvOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAnUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FtYXpvbkFQSUdhdGV3YXlQdXNoVG9DbG91ZFdhdGNoTG9ncycsXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0cnVlLFxuICAgICAgICApO1xuXG4gICAgICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgICAgICAgIHRoaXMuYXBpLFxuICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HNCcsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ1ByaXZhdGUgQVBJLiBBdXRoZW50aWNhdGlvbiBpcyBub3QgcmVxdWlyZWQgZm9yIG5vdyBhcyB0aGUgcHJpdmF0ZSB6b25lIGlzIGNvbnNpZGVyZWQgdHJ1c3RlZCcsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0cnVlLFxuICAgICAgICApO1xuXG4gICAgICAgIHRoaXMuY3JlYXRlT3V0cHV0cygpO1xuICAgIH1cbiAgICBhZGRGdW5jdGlvblBlcm1pc3Npb25zKHByb3BlcnRpZXM6IFN0YXR1c1VwZGF0ZXJTZXJ2aWNlUHJvcGVydGllcyk6IHZvaWQge1xuICAgICAgICBpZiAodGhpcy5mdW5jdGlvbikge1xuICAgICAgICAgICAgdGhpcy5mdW5jdGlvbi5yb2xlPy5hZGRNYW5hZ2VkUG9saWN5KFxuICAgICAgICAgICAgICAgIE1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdDbG91ZFdhdGNoTGFtYmRhSW5zaWdodHNFeGVjdXRpb25Sb2xlUG9saWN5JyksXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgdGhpcy5mdW5jdGlvbi5yb2xlPy5hZGRNYW5hZ2VkUG9saWN5KFxuICAgICAgICAgICAgICAgIE1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBwcm9wZXJ0aWVzLnRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh0aGlzLmZ1bmN0aW9uKTtcblxuICAgICAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgICAgICAgICAgIHRoaXMuZnVuY3Rpb24ucm9sZSEsXG4gICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ01hbmFnZWQgUG9saWNpZXMgYXJlIGFjY2VwdGFibGUgZm9yIHRoZSB0YXNrIHJvbGUnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ1Blcm1pc3Npb25zIGFyZSBhY2NlcHRhYmxlIGZvciB0aGUgdGFzayByb2xlJyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHRydWUsXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNyZWF0ZU91dHB1dHMoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLmFwaSkge1xuICAgICAgICAgICAgVXRpbGl0aWVzLmNyZWF0ZVNzbVBhcmFtZXRlcnMoXG4gICAgICAgICAgICAgICAgdGhpcyxcbiAgICAgICAgICAgICAgICBQQVJBTUVURVJfU1RPUkVfUFJFRklYLFxuICAgICAgICAgICAgICAgIG5ldyBNYXAoXG4gICAgICAgICAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZWFkb3B0aW9uc3RhdHVzdXJsOiB0aGlzLmFwaS51cmwsXG4gICAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZXJ2aWNlIGlzIG5vdCBkZWZpbmVkJyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZ2V0RW52aXJvbm1lbnRWYXJpYWJsZXMocHJvcGVydGllczogU3RhdHVzVXBkYXRlclNlcnZpY2VQcm9wZXJ0aWVzKTogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSB8IHVuZGVmaW5lZCB7XG4gICAgICAgIC8vIE5vIGVudmlyb25tZW50IHZhcmlhYmxlcyB0byBjcmVhdGVcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIFRBQkxFX05BTUU6IHByb3BlcnRpZXMudGFibGUudGFibGVOYW1lLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBnZXRMYXllcnMoKTogSUxheWVyVmVyc2lvbltdIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIExheWVyVmVyc2lvbi5mcm9tTGF5ZXJWZXJzaW9uQXJuKFxuICAgICAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICAgICAgJ0xhbWJkYUluc2lnaHRzTGF5ZXInLFxuICAgICAgICAgICAgICAgIGdldExhbWJkYUluc2lnaHRzTGF5ZXJBcm4oU3RhY2sub2YodGhpcykucmVnaW9uKSxcbiAgICAgICAgICAgICksXG4gICAgICAgIF07XG4gICAgfVxuICAgIGdldEJ1bmRsaW5nKCk6IEJ1bmRsaW5nT3B0aW9ucyB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtdLFxuICAgICAgICAgICAgbm9kZU1vZHVsZXM6IFsnYXdzLXhyYXktc2RrLWNvcmUnLCAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJywgJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYiddLFxuICAgICAgICB9O1xuICAgIH1cbn1cbiJdfQ==