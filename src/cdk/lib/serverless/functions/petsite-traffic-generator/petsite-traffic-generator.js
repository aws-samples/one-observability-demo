"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PetsiteTrafficGeneratorFunction = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const lambda_1 = require("../../../constructs/lambda");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
class PetsiteTrafficGeneratorFunction extends lambda_1.WokshopLambdaFunction {
    constructor(scope, id, properties) {
        super(scope, id, properties);
        this.createOutputs();
    }
    addFunctionPermissions(properties) {
        if (this.function) {
            this.function.role?.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy'));
            this.function.role?.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
            new aws_iam_1.Policy(this, 'PetsiteTrafficGeneratorPolicy', {
                policyName: 'PetsiteTrafficGeneratorPolicy',
                document: new aws_iam_1.PolicyDocument({
                    statements: [
                        new aws_iam_1.PolicyStatement({
                            effect: aws_iam_1.Effect.ALLOW,
                            actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
                            resources: [`arn:aws:ssm:${aws_cdk_lib_1.Stack.of(this).region}:${aws_cdk_lib_1.Stack.of(this).account}:parameter/petstore/*`],
                        }),
                    ],
                }),
                roles: [this.function.role],
            });
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
    createOutputs() { }
    getEnvironmentVariables(properties) {
        return {
            PETSITE_URL_PARAMETER_NAME: '/petstore/petsiteurl',
        };
    }
    getBundling() {
        return {
            externalModules: [],
            nodeModules: ['@aws-sdk/client-ssm', 'puppeteer'],
        };
    }
    getLayers() {
        return [
            aws_lambda_1.LayerVersion.fromLayerVersionArn(this, 'LambdaInsightsLayer', (0, lambda_1.getLambdaInsightsLayerArn)(aws_cdk_lib_1.Stack.of(this).region)),
        ];
    }
}
exports.PetsiteTrafficGeneratorFunction = PetsiteTrafficGeneratorFunction;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGV0c2l0ZS10cmFmZmljLWdlbmVyYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBldHNpdGUtdHJhZmZpYy1nZW5lcmF0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUE7OztFQUdFO0FBQ0YsdURBSW9DO0FBRXBDLGlEQUFxRztBQUNyRyx1REFBcUU7QUFDckUsNkNBQW9EO0FBRXBELHFDQUEwQztBQUUxQyxNQUFhLCtCQUFnQyxTQUFRLDhCQUFxQjtJQUN0RSxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFVBQTRDO1FBQ2xGLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRTdCLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUN6QixDQUFDO0lBRUQsc0JBQXNCLENBQUMsVUFBNEM7UUFDL0QsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDaEIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLENBQ2hDLHVCQUFhLENBQUMsd0JBQXdCLENBQUMsNkNBQTZDLENBQUMsQ0FDeEYsQ0FBQztZQUNGLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGdCQUFnQixDQUNoQyx1QkFBYSxDQUFDLHdCQUF3QixDQUFDLDBDQUEwQyxDQUFDLENBQ3JGLENBQUM7WUFFRixJQUFJLGdCQUFNLENBQUMsSUFBSSxFQUFFLCtCQUErQixFQUFFO2dCQUM5QyxVQUFVLEVBQUUsK0JBQStCO2dCQUMzQyxRQUFRLEVBQUUsSUFBSSx3QkFBYyxDQUFDO29CQUN6QixVQUFVLEVBQUU7d0JBQ1IsSUFBSSx5QkFBZSxDQUFDOzRCQUNoQixNQUFNLEVBQUUsZ0JBQU0sQ0FBQyxLQUFLOzRCQUNwQixPQUFPLEVBQUUsQ0FBQyxrQkFBa0IsRUFBRSxtQkFBbUIsRUFBRSx5QkFBeUIsQ0FBQzs0QkFDN0UsU0FBUyxFQUFFLENBQUMsZUFBZSxtQkFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyx1QkFBdUIsQ0FBQzt5QkFDckcsQ0FBQztxQkFDTDtpQkFDSixDQUFDO2dCQUNGLEtBQUssRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSyxDQUFDO2FBQy9CLENBQUMsQ0FBQztZQUVILHlCQUFlLENBQUMsdUJBQXVCLENBQ25DLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSyxFQUNuQjtnQkFDSTtvQkFDSSxFQUFFLEVBQUUsbUJBQW1CO29CQUN2QixNQUFNLEVBQUUsbURBQW1EO2lCQUM5RDtnQkFDRDtvQkFDSSxFQUFFLEVBQUUsbUJBQW1CO29CQUN2QixNQUFNLEVBQUUsOENBQThDO2lCQUN6RDthQUNKLEVBQ0QsSUFBSSxDQUNQLENBQUM7UUFDTixDQUFDO0lBQ0wsQ0FBQztJQUVELGFBQWEsS0FBVSxDQUFDO0lBRXhCLHVCQUF1QixDQUFDLFVBQTRDO1FBQ2hFLE9BQU87WUFDSCwwQkFBMEIsRUFBRSxzQkFBc0I7U0FDckQsQ0FBQztJQUNOLENBQUM7SUFFRCxXQUFXO1FBQ1AsT0FBTztZQUNILGVBQWUsRUFBRSxFQUFFO1lBQ25CLFdBQVcsRUFBRSxDQUFDLHFCQUFxQixFQUFFLFdBQVcsQ0FBQztTQUNwRCxDQUFDO0lBQ04sQ0FBQztJQUVELFNBQVM7UUFDTCxPQUFPO1lBQ0gseUJBQVksQ0FBQyxtQkFBbUIsQ0FDNUIsSUFBSSxFQUNKLHFCQUFxQixFQUNyQixJQUFBLGtDQUF5QixFQUFDLG1CQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUNuRDtTQUNKLENBQUM7SUFDTixDQUFDO0NBQ0o7QUF2RUQsMEVBdUVDIiwic291cmNlc0NvbnRlbnQiOlsiLypcbkNvcHlyaWdodCBBbWF6b24uY29tLCBJbmMuIG9yIGl0cyBhZmZpbGlhdGVzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiovXG5pbXBvcnQge1xuICAgIFdva3Nob3BMYW1iZGFGdW5jdGlvbixcbiAgICBXb3Jrc2hvcExhbWJkYUZ1bmN0aW9uUHJvcGVydGllcyxcbiAgICBnZXRMYW1iZGFJbnNpZ2h0c0xheWVyQXJuLFxufSBmcm9tICcuLi8uLi8uLi9jb25zdHJ1Y3RzL2xhbWJkYSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE1hbmFnZWRQb2xpY3ksIFBvbGljeURvY3VtZW50LCBFZmZlY3QsIFBvbGljeVN0YXRlbWVudCwgUG9saWN5IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBJTGF5ZXJWZXJzaW9uLCBMYXllclZlcnNpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IEFybiwgQXJuRm9ybWF0LCBTdGFjayB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEJ1bmRsaW5nT3B0aW9ucyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuXG5leHBvcnQgY2xhc3MgUGV0c2l0ZVRyYWZmaWNHZW5lcmF0b3JGdW5jdGlvbiBleHRlbmRzIFdva3Nob3BMYW1iZGFGdW5jdGlvbiB7XG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcGVydGllczogV29ya3Nob3BMYW1iZGFGdW5jdGlvblByb3BlcnRpZXMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wZXJ0aWVzKTtcblxuICAgICAgICB0aGlzLmNyZWF0ZU91dHB1dHMoKTtcbiAgICB9XG5cbiAgICBhZGRGdW5jdGlvblBlcm1pc3Npb25zKHByb3BlcnRpZXM6IFdvcmtzaG9wTGFtYmRhRnVuY3Rpb25Qcm9wZXJ0aWVzKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLmZ1bmN0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLmZ1bmN0aW9uLnJvbGU/LmFkZE1hbmFnZWRQb2xpY3koXG4gICAgICAgICAgICAgICAgTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0Nsb3VkV2F0Y2hMYW1iZGFJbnNpZ2h0c0V4ZWN1dGlvblJvbGVQb2xpY3knKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICB0aGlzLmZ1bmN0aW9uLnJvbGU/LmFkZE1hbmFnZWRQb2xpY3koXG4gICAgICAgICAgICAgICAgTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIG5ldyBQb2xpY3kodGhpcywgJ1BldHNpdGVUcmFmZmljR2VuZXJhdG9yUG9saWN5Jywge1xuICAgICAgICAgICAgICAgIHBvbGljeU5hbWU6ICdQZXRzaXRlVHJhZmZpY0dlbmVyYXRvclBvbGljeScsXG4gICAgICAgICAgICAgICAgZG9jdW1lbnQ6IG5ldyBQb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3NtOkdldFBhcmFtZXRlcicsICdzc206R2V0UGFyYW1ldGVycycsICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCddLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOnNzbToke1N0YWNrLm9mKHRoaXMpLnJlZ2lvbn06JHtTdGFjay5vZih0aGlzKS5hY2NvdW50fTpwYXJhbWV0ZXIvcGV0c3RvcmUvKmBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgcm9sZXM6IFt0aGlzLmZ1bmN0aW9uLnJvbGUhXSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICAgICAgdGhpcy5mdW5jdGlvbi5yb2xlISxcbiAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnTWFuYWdlZCBQb2xpY2llcyBhcmUgYWNjZXB0YWJsZSBmb3IgdGhlIHRhc2sgcm9sZScsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnUGVybWlzc2lvbnMgYXJlIGFjY2VwdGFibGUgZm9yIHRoZSB0YXNrIHJvbGUnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjcmVhdGVPdXRwdXRzKCk6IHZvaWQge31cblxuICAgIGdldEVudmlyb25tZW50VmFyaWFibGVzKHByb3BlcnRpZXM6IFdvcmtzaG9wTGFtYmRhRnVuY3Rpb25Qcm9wZXJ0aWVzKTogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBQRVRTSVRFX1VSTF9QQVJBTUVURVJfTkFNRTogJy9wZXRzdG9yZS9wZXRzaXRldXJsJyxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBnZXRCdW5kbGluZygpOiBCdW5kbGluZ09wdGlvbnMge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXSxcbiAgICAgICAgICAgIG5vZGVNb2R1bGVzOiBbJ0Bhd3Mtc2RrL2NsaWVudC1zc20nLCAncHVwcGV0ZWVyJ10sXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgZ2V0TGF5ZXJzKCk6IElMYXllclZlcnNpb25bXSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICBMYXllclZlcnNpb24uZnJvbUxheWVyVmVyc2lvbkFybihcbiAgICAgICAgICAgICAgICB0aGlzLFxuICAgICAgICAgICAgICAgICdMYW1iZGFJbnNpZ2h0c0xheWVyJyxcbiAgICAgICAgICAgICAgICBnZXRMYW1iZGFJbnNpZ2h0c0xheWVyQXJuKFN0YWNrLm9mKHRoaXMpLnJlZ2lvbiksXG4gICAgICAgICAgICApLFxuICAgICAgICBdO1xuICAgIH1cbn1cbiJdfQ==