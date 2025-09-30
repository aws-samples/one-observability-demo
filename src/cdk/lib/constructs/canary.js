"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkshopCanary = exports.CanaryNames = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_synthetics_1 = require("aws-cdk-lib/aws-synthetics");
const constructs_1 = require("constructs");
const environment_1 = require("../../bin/environment");
const cdk_nag_1 = require("cdk-nag");
exports.CanaryNames = {
    /** Pet status updater function name */
    Petsite: environment_1.PETSITE_CANARY.name,
    HouseKeeping: environment_1.HOUSEKEEPING_CANARY.name,
};
class WorkshopCanary extends constructs_1.Construct {
    constructor(scope, id, properties) {
        super(scope, id);
        this.canary = new aws_synthetics_1.Canary(this, `canary-${id}`, {
            canaryName: properties.name,
            runtime: properties.runtime,
            schedule: aws_synthetics_1.Schedule.expression(properties.scheduleExpression || 'rate(5 minutes)'),
            test: aws_synthetics_1.Test.custom({
                handler: properties.handler,
                code: aws_synthetics_1.Code.fromAsset(properties.path),
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
            resourcesToReplicateTags: [aws_synthetics_1.ResourceToReplicateTags.LAMBDA_FUNCTION],
            artifactsBucketLifecycleRules: [
                {
                    expiration: aws_cdk_lib_1.Duration.days(properties.logRetentionDays?.valueOf() || 30),
                },
            ],
            timeToLive: aws_cdk_lib_1.Duration.minutes(5),
            startAfterCreation: true,
        });
        const parameterStorePolicy = new aws_iam_1.Policy(this, `${id}-paramterstore-policy`, {
            statements: [WorkshopCanary.getDefaultSSMPolicy(this, '/petstore/')],
            roles: [this.canary.role],
        });
        this.canary.role.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.canary.role, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Suppress wildcard permissions created by the Canary Construct',
            },
            {
                id: 'AwsSolutions-IAM4',
                reason: 'XRay managed polices are acceptable',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(parameterStorePolicy, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'This allows the canary to read parameters for the application and perform multiple actions',
                appliesTo: [
                    `Resource::arn:aws:ssm:${aws_cdk_lib_1.Stack.of(this).region}:${aws_cdk_lib_1.Stack.of(this).account}:parameter/petstore/*`,
                ],
            },
        ], true);
    }
    static getDefaultSSMPolicy(scope, prefix) {
        const cleanPrefix = (prefix || '/petstore/').startsWith('/')
            ? (prefix || '/petstore/').slice(1)
            : prefix || '/petstore/';
        const readSMParametersPolicy = new aws_iam_1.PolicyStatement({
            effect: aws_iam_1.Effect.ALLOW,
            actions: ['ssm:GetParametersByPath', 'ssm:GetParameters', 'ssm:GetParameter'],
            resources: [`arn:aws:ssm:${aws_cdk_lib_1.Stack.of(scope).region}:${aws_cdk_lib_1.Stack.of(scope).account}:parameter/${cleanPrefix}*`],
        });
        return readSMParametersPolicy;
    }
}
exports.WorkshopCanary = WorkshopCanary;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FuYXJ5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY2FuYXJ5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZDQUE4QztBQUM5QyxpREFBcUY7QUFHckYsK0RBQTRHO0FBQzVHLDJDQUF1QztBQUN2Qyx1REFBNEU7QUFDNUUscUNBQTBDO0FBWTdCLFFBQUEsV0FBVyxHQUFHO0lBQ3ZCLHVDQUF1QztJQUN2QyxPQUFPLEVBQUUsNEJBQWMsQ0FBQyxJQUFJO0lBQzVCLFlBQVksRUFBRSxpQ0FBbUIsQ0FBQyxJQUFJO0NBQ2hDLENBQUM7QUFFWCxNQUFzQixjQUFlLFNBQVEsc0JBQVM7SUFFbEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUFvQztRQUMxRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSx1QkFBTSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsRUFBRSxFQUFFO1lBQzNDLFVBQVUsRUFBRSxVQUFVLENBQUMsSUFBSTtZQUMzQixPQUFPLEVBQUUsVUFBVSxDQUFDLE9BQU87WUFDM0IsUUFBUSxFQUFFLHlCQUFRLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsSUFBSSxpQkFBaUIsQ0FBQztZQUNqRixJQUFJLEVBQUUscUJBQUksQ0FBQyxNQUFNLENBQUM7Z0JBQ2QsT0FBTyxFQUFFLFVBQVUsQ0FBQyxPQUFPO2dCQUMzQixJQUFJLEVBQUUscUJBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQzthQUN4QyxDQUFDO1lBQ0YsYUFBYSxFQUFFLElBQUk7WUFDbkIsdUJBQXVCLEVBQUUsVUFBVSxDQUFDLGVBQWU7Z0JBQy9DLENBQUMsQ0FBQztvQkFDSSxNQUFNLEVBQUUsVUFBVSxDQUFDLGVBQWU7b0JBQ2xDLE1BQU0sRUFBRSxVQUFVLEVBQUUsRUFBRTtpQkFDekI7Z0JBQ0gsQ0FBQyxDQUFDLFNBQVM7WUFDZixvQkFBb0IsRUFBRSxJQUFJLENBQUMsdUJBQXVCLENBQUMsVUFBVSxDQUFDO1lBQzlELDBCQUEwQixFQUFFLElBQUk7WUFDaEMsd0JBQXdCLEVBQUUsQ0FBQyx3Q0FBdUIsQ0FBQyxlQUFlLENBQUM7WUFDbkUsNkJBQTZCLEVBQUU7Z0JBQzNCO29CQUNJLFVBQVUsRUFBRSxzQkFBUSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsZ0JBQWdCLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO2lCQUMxRTthQUNKO1lBQ0QsVUFBVSxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUMvQixrQkFBa0IsRUFBRSxJQUFJO1NBQzNCLENBQUMsQ0FBQztRQUVILE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxnQkFBTSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsdUJBQXVCLEVBQUU7WUFDeEUsVUFBVSxFQUFFLENBQUMsY0FBYyxDQUFDLG1CQUFtQixDQUFDLElBQUksRUFBRSxZQUFZLENBQUMsQ0FBQztZQUNwRSxLQUFLLEVBQUUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztTQUM1QixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyx1QkFBYSxDQUFDLHdCQUF3QixDQUFDLDBCQUEwQixDQUFDLENBQUMsQ0FBQztRQUV0Ryx5QkFBZSxDQUFDLHVCQUF1QixDQUNuQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFDaEI7WUFDSTtnQkFDSSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsK0RBQStEO2FBQzFFO1lBQ0Q7Z0JBQ0ksRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLHFDQUFxQzthQUNoRDtTQUNKLEVBQ0QsSUFBSSxDQUNQLENBQUM7UUFDRix5QkFBZSxDQUFDLHVCQUF1QixDQUNuQyxvQkFBb0IsRUFDcEI7WUFDSTtnQkFDSSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsNEZBQTRGO2dCQUNwRyxTQUFTLEVBQUU7b0JBQ1AseUJBQXlCLG1CQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sSUFBSSxtQkFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLHVCQUF1QjtpQkFDbEc7YUFDSjtTQUNKLEVBQ0QsSUFBSSxDQUNQLENBQUM7SUFDTixDQUFDO0lBRU0sTUFBTSxDQUFDLG1CQUFtQixDQUFDLEtBQWdCLEVBQUUsTUFBZTtRQUMvRCxNQUFNLFdBQVcsR0FBRyxDQUFDLE1BQU0sSUFBSSxZQUFZLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDO1lBQ3hELENBQUMsQ0FBQyxDQUFDLE1BQU0sSUFBSSxZQUFZLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQ25DLENBQUMsQ0FBQyxNQUFNLElBQUksWUFBWSxDQUFDO1FBQzdCLE1BQU0sc0JBQXNCLEdBQUcsSUFBSSx5QkFBZSxDQUFDO1lBQy9DLE1BQU0sRUFBRSxnQkFBTSxDQUFDLEtBQUs7WUFDcEIsT0FBTyxFQUFFLENBQUMseUJBQXlCLEVBQUUsbUJBQW1CLEVBQUUsa0JBQWtCLENBQUM7WUFDN0UsU0FBUyxFQUFFLENBQUMsZUFBZSxtQkFBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLElBQUksbUJBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxjQUFjLFdBQVcsR0FBRyxDQUFDO1NBQzVHLENBQUMsQ0FBQztRQUVILE9BQU8sc0JBQXNCLENBQUM7SUFDbEMsQ0FBQztDQWtCSjtBQWpHRCx3Q0FpR0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEdXJhdGlvbiwgU3RhY2sgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBFZmZlY3QsIE1hbmFnZWRQb2xpY3ksIFBvbGljeSwgUG9saWN5U3RhdGVtZW50IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgSUJ1Y2tldCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgeyBDYW5hcnksIENvZGUsIFJlc291cmNlVG9SZXBsaWNhdGVUYWdzLCBSdW50aW1lLCBTY2hlZHVsZSwgVGVzdCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zeW50aGV0aWNzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgSE9VU0VLRUVQSU5HX0NBTkFSWSwgUEVUU0lURV9DQU5BUlkgfSBmcm9tICcuLi8uLi9iaW4vZW52aXJvbm1lbnQnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgV29ya3Nob3BDYW5hcnlQcm9wZXJ0aWVzIHtcbiAgICBhcnRpZmFjdHNCdWNrZXQ/OiBJQnVja2V0O1xuICAgIHJ1bnRpbWU6IFJ1bnRpbWU7XG4gICAgc2NoZWR1bGVFeHByZXNzaW9uPzogc3RyaW5nO1xuICAgIGhhbmRsZXI6IHN0cmluZztcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgbG9nUmV0ZW50aW9uRGF5cz86IFJldGVudGlvbkRheXM7XG4gICAgbmFtZTogc3RyaW5nO1xufVxuXG5leHBvcnQgY29uc3QgQ2FuYXJ5TmFtZXMgPSB7XG4gICAgLyoqIFBldCBzdGF0dXMgdXBkYXRlciBmdW5jdGlvbiBuYW1lICovXG4gICAgUGV0c2l0ZTogUEVUU0lURV9DQU5BUlkubmFtZSxcbiAgICBIb3VzZUtlZXBpbmc6IEhPVVNFS0VFUElOR19DQU5BUlkubmFtZSxcbn0gYXMgY29uc3Q7XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBXb3Jrc2hvcENhbmFyeSBleHRlbmRzIENvbnN0cnVjdCB7XG4gICAgcHVibGljIGNhbmFyeTogQ2FuYXJ5O1xuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BlcnRpZXM6IFdvcmtzaG9wQ2FuYXJ5UHJvcGVydGllcykge1xuICAgICAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgICAgIHRoaXMuY2FuYXJ5ID0gbmV3IENhbmFyeSh0aGlzLCBgY2FuYXJ5LSR7aWR9YCwge1xuICAgICAgICAgICAgY2FuYXJ5TmFtZTogcHJvcGVydGllcy5uYW1lLFxuICAgICAgICAgICAgcnVudGltZTogcHJvcGVydGllcy5ydW50aW1lLFxuICAgICAgICAgICAgc2NoZWR1bGU6IFNjaGVkdWxlLmV4cHJlc3Npb24ocHJvcGVydGllcy5zY2hlZHVsZUV4cHJlc3Npb24gfHwgJ3JhdGUoNSBtaW51dGVzKScpLFxuICAgICAgICAgICAgdGVzdDogVGVzdC5jdXN0b20oe1xuICAgICAgICAgICAgICAgIGhhbmRsZXI6IHByb3BlcnRpZXMuaGFuZGxlcixcbiAgICAgICAgICAgICAgICBjb2RlOiBDb2RlLmZyb21Bc3NldChwcm9wZXJ0aWVzLnBhdGgpLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBhY3RpdmVUcmFjaW5nOiB0cnVlLFxuICAgICAgICAgICAgYXJ0aWZhY3RzQnVja2V0TG9jYXRpb246IHByb3BlcnRpZXMuYXJ0aWZhY3RzQnVja2V0XG4gICAgICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgICAgICAgICAgYnVja2V0OiBwcm9wZXJ0aWVzLmFydGlmYWN0c0J1Y2tldCxcbiAgICAgICAgICAgICAgICAgICAgICBwcmVmaXg6IGBjYW5hcnktJHtpZH1gLFxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHRoaXMuZ2V0RW52aXJvbm1lbnRWYXJpYWJsZXMocHJvcGVydGllcyksXG4gICAgICAgICAgICBwcm92aXNpb25lZFJlc291cmNlQ2xlYW51cDogdHJ1ZSxcbiAgICAgICAgICAgIHJlc291cmNlc1RvUmVwbGljYXRlVGFnczogW1Jlc291cmNlVG9SZXBsaWNhdGVUYWdzLkxBTUJEQV9GVU5DVElPTl0sXG4gICAgICAgICAgICBhcnRpZmFjdHNCdWNrZXRMaWZlY3ljbGVSdWxlczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgZXhwaXJhdGlvbjogRHVyYXRpb24uZGF5cyhwcm9wZXJ0aWVzLmxvZ1JldGVudGlvbkRheXM/LnZhbHVlT2YoKSB8fCAzMCksXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB0aW1lVG9MaXZlOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgc3RhcnRBZnRlckNyZWF0aW9uOiB0cnVlLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBwYXJhbWV0ZXJTdG9yZVBvbGljeSA9IG5ldyBQb2xpY3kodGhpcywgYCR7aWR9LXBhcmFtdGVyc3RvcmUtcG9saWN5YCwge1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1dvcmtzaG9wQ2FuYXJ5LmdldERlZmF1bHRTU01Qb2xpY3kodGhpcywgJy9wZXRzdG9yZS8nKV0sXG4gICAgICAgICAgICByb2xlczogW3RoaXMuY2FuYXJ5LnJvbGVdLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmNhbmFyeS5yb2xlLmFkZE1hbmFnZWRQb2xpY3koTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FXU1hSYXlEYWVtb25Xcml0ZUFjY2VzcycpKTtcblxuICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICB0aGlzLmNhbmFyeS5yb2xlLFxuICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ1N1cHByZXNzIHdpbGRjYXJkIHBlcm1pc3Npb25zIGNyZWF0ZWQgYnkgdGhlIENhbmFyeSBDb25zdHJ1Y3QnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnWFJheSBtYW5hZ2VkIHBvbGljZXMgYXJlIGFjY2VwdGFibGUnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgKTtcbiAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgICAgICAgcGFyYW1ldGVyU3RvcmVQb2xpY3ksXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnVGhpcyBhbGxvd3MgdGhlIGNhbmFyeSB0byByZWFkIHBhcmFtZXRlcnMgZm9yIHRoZSBhcHBsaWNhdGlvbiBhbmQgcGVyZm9ybSBtdWx0aXBsZSBhY3Rpb25zJyxcbiAgICAgICAgICAgICAgICAgICAgYXBwbGllc1RvOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICBgUmVzb3VyY2U6OmFybjphd3M6c3NtOiR7U3RhY2sub2YodGhpcykucmVnaW9ufToke1N0YWNrLm9mKHRoaXMpLmFjY291bnR9OnBhcmFtZXRlci9wZXRzdG9yZS8qYCxcbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHRydWUsXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgcHVibGljIHN0YXRpYyBnZXREZWZhdWx0U1NNUG9saWN5KHNjb3BlOiBDb25zdHJ1Y3QsIHByZWZpeD86IHN0cmluZykge1xuICAgICAgICBjb25zdCBjbGVhblByZWZpeCA9IChwcmVmaXggfHwgJy9wZXRzdG9yZS8nKS5zdGFydHNXaXRoKCcvJylcbiAgICAgICAgICAgID8gKHByZWZpeCB8fCAnL3BldHN0b3JlLycpLnNsaWNlKDEpXG4gICAgICAgICAgICA6IHByZWZpeCB8fCAnL3BldHN0b3JlLyc7XG4gICAgICAgIGNvbnN0IHJlYWRTTVBhcmFtZXRlcnNQb2xpY3kgPSBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogWydzc206R2V0UGFyYW1ldGVyc0J5UGF0aCcsICdzc206R2V0UGFyYW1ldGVycycsICdzc206R2V0UGFyYW1ldGVyJ10sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpzc206JHtTdGFjay5vZihzY29wZSkucmVnaW9ufToke1N0YWNrLm9mKHNjb3BlKS5hY2NvdW50fTpwYXJhbWV0ZXIvJHtjbGVhblByZWZpeH0qYF0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZWFkU01QYXJhbWV0ZXJzUG9saWN5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgQ2xvdWRGb3JtYXRpb24gb3V0cHV0cyBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICAgKiBNdXN0IGJlIGltcGxlbWVudGVkIGJ5IGNvbmNyZXRlIHN1YmNsYXNzZXMuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gcHJvcGVydGllcyAtIEZ1bmN0aW9uIGNvbmZpZ3VyYXRpb24gcHJvcGVydGllc1xuICAgICAqL1xuICAgIGFic3RyYWN0IGNyZWF0ZU91dHB1dHMocHJvcGVydGllczogV29ya3Nob3BDYW5hcnlQcm9wZXJ0aWVzKTogdm9pZDtcblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgICAqIE11c3QgYmUgaW1wbGVtZW50ZWQgYnkgY29uY3JldGUgc3ViY2xhc3Nlcy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gRnVuY3Rpb24gY29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzXG4gICAgICogQHJldHVybnMgTWFwIG9mIGVudmlyb25tZW50IHZhcmlhYmxlIG5hbWVzIHRvIHZhbHVlc1xuICAgICAqL1xuICAgIGFic3RyYWN0IGdldEVudmlyb25tZW50VmFyaWFibGVzKHByb3BlcnRpZXM6IFdvcmtzaG9wQ2FuYXJ5UHJvcGVydGllcyk6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0gfCB1bmRlZmluZWQ7XG59XG4iXX0=