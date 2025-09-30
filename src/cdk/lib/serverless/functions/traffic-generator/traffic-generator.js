"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrafficGeneratorFunction = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const lambda_1 = require("../../../constructs/lambda");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
class TrafficGeneratorFunction extends lambda_1.WokshopLambdaFunction {
    constructor(scope, id, properties) {
        super(scope, id, properties);
        this.createOutputs();
    }
    addFunctionPermissions(properties) {
        if (this.function) {
            this.function.role?.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLambdaInsightsExecutionRolePolicy'));
            this.function.role?.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
            new aws_iam_1.Policy(this, 'TrafficGeneratorPolicy', {
                policyName: 'TrafficGeneratorPolicy',
                document: new aws_iam_1.PolicyDocument({
                    statements: [
                        new aws_iam_1.PolicyStatement({
                            effect: aws_iam_1.Effect.ALLOW,
                            actions: ['lambda:InvokeFunction'],
                            resources: [properties.petsiteTrafficFunction.functionArn],
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
            PETSITE_TRAFFIC_FUNCTION_ARN: properties.petsiteTrafficFunction.functionArn,
        };
    }
    getBundling() {
        return {
            externalModules: [],
            nodeModules: ['@aws-sdk/client-lambda'],
        };
    }
    getLayers() {
        return [
            aws_lambda_1.LayerVersion.fromLayerVersionArn(this, 'LambdaInsightsLayer', (0, lambda_1.getLambdaInsightsLayerArn)(aws_cdk_lib_1.Stack.of(this).region)),
        ];
    }
}
exports.TrafficGeneratorFunction = TrafficGeneratorFunction;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhZmZpYy1nZW5lcmF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ0cmFmZmljLWdlbmVyYXRvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQTs7O0VBR0U7QUFDRix1REFJb0M7QUFFcEMsaURBQXFHO0FBQ3JHLHVEQUFxRTtBQUNyRSw2Q0FBb0Q7QUFHcEQscUNBQTBDO0FBTzFDLE1BQWEsd0JBQXlCLFNBQVEsOEJBQXFCO0lBRS9ELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsVUFBOEM7UUFDcEYsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFFN0IsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ3pCLENBQUM7SUFDRCxzQkFBc0IsQ0FBQyxVQUE4QztRQUNqRSxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNoQixJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxnQkFBZ0IsQ0FDaEMsdUJBQWEsQ0FBQyx3QkFBd0IsQ0FBQyw2Q0FBNkMsQ0FBQyxDQUN4RixDQUFDO1lBQ0YsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLENBQ2hDLHVCQUFhLENBQUMsd0JBQXdCLENBQUMsMENBQTBDLENBQUMsQ0FDckYsQ0FBQztZQUVGLElBQUksZ0JBQU0sQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7Z0JBQ3ZDLFVBQVUsRUFBRSx3QkFBd0I7Z0JBQ3BDLFFBQVEsRUFBRSxJQUFJLHdCQUFjLENBQUM7b0JBQ3pCLFVBQVUsRUFBRTt3QkFDUixJQUFJLHlCQUFlLENBQUM7NEJBQ2hCLE1BQU0sRUFBRSxnQkFBTSxDQUFDLEtBQUs7NEJBQ3BCLE9BQU8sRUFBRSxDQUFDLHVCQUF1QixDQUFDOzRCQUNsQyxTQUFTLEVBQUUsQ0FBQyxVQUFVLENBQUMsc0JBQXNCLENBQUMsV0FBVyxDQUFDO3lCQUM3RCxDQUFDO3FCQUNMO2lCQUNKLENBQUM7Z0JBQ0YsS0FBSyxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFLLENBQUM7YUFDL0IsQ0FBQyxDQUFDO1lBRUgseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDbkMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFLLEVBQ25CO2dCQUNJO29CQUNJLEVBQUUsRUFBRSxtQkFBbUI7b0JBQ3ZCLE1BQU0sRUFBRSxtREFBbUQ7aUJBQzlEO2dCQUNEO29CQUNJLEVBQUUsRUFBRSxtQkFBbUI7b0JBQ3ZCLE1BQU0sRUFBRSw4Q0FBOEM7aUJBQ3pEO2FBQ0osRUFDRCxJQUFJLENBQ1AsQ0FBQztRQUNOLENBQUM7SUFDTCxDQUFDO0lBQ0QsYUFBYSxLQUFVLENBQUM7SUFDeEIsdUJBQXVCLENBQUMsVUFBOEM7UUFDbEUsT0FBTztZQUNILDRCQUE0QixFQUFFLFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxXQUFXO1NBQzlFLENBQUM7SUFDTixDQUFDO0lBRUQsV0FBVztRQUNQLE9BQU87WUFDSCxlQUFlLEVBQUUsRUFBRTtZQUNuQixXQUFXLEVBQUUsQ0FBQyx3QkFBd0IsQ0FBQztTQUMxQyxDQUFDO0lBQ04sQ0FBQztJQUVELFNBQVM7UUFDTCxPQUFPO1lBQ0gseUJBQVksQ0FBQyxtQkFBbUIsQ0FDNUIsSUFBSSxFQUNKLHFCQUFxQixFQUNyQixJQUFBLGtDQUF5QixFQUFDLG1CQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUNuRDtTQUNKLENBQUM7SUFDTixDQUFDO0NBQ0o7QUFyRUQsNERBcUVDIiwic291cmNlc0NvbnRlbnQiOlsiLypcbkNvcHlyaWdodCBBbWF6b24uY29tLCBJbmMuIG9yIGl0cyBhZmZpbGlhdGVzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiovXG5pbXBvcnQge1xuICAgIFdva3Nob3BMYW1iZGFGdW5jdGlvbixcbiAgICBXb3Jrc2hvcExhbWJkYUZ1bmN0aW9uUHJvcGVydGllcyxcbiAgICBnZXRMYW1iZGFJbnNpZ2h0c0xheWVyQXJuLFxufSBmcm9tICcuLi8uLi8uLi9jb25zdHJ1Y3RzL2xhbWJkYSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE1hbmFnZWRQb2xpY3ksIFBvbGljeURvY3VtZW50LCBFZmZlY3QsIFBvbGljeVN0YXRlbWVudCwgUG9saWN5IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBJTGF5ZXJWZXJzaW9uLCBMYXllclZlcnNpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IEFybiwgQXJuRm9ybWF0LCBTdGFjayB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IEJ1bmRsaW5nT3B0aW9ucyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCB7IExhbWJkYVJlc3RBcGkgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcbmltcG9ydCB7IEZ1bmN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhZmZpY0dlbmVyYXRvckZ1bmN0aW9uUHJvcGVydGllcyBleHRlbmRzIFdvcmtzaG9wTGFtYmRhRnVuY3Rpb25Qcm9wZXJ0aWVzIHtcbiAgICBwZXRzaXRlVHJhZmZpY0Z1bmN0aW9uOiBGdW5jdGlvbjtcbn1cblxuZXhwb3J0IGNsYXNzIFRyYWZmaWNHZW5lcmF0b3JGdW5jdGlvbiBleHRlbmRzIFdva3Nob3BMYW1iZGFGdW5jdGlvbiB7XG4gICAgcHVibGljIGFwaTogTGFtYmRhUmVzdEFwaTtcbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBUcmFmZmljR2VuZXJhdG9yRnVuY3Rpb25Qcm9wZXJ0aWVzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcGVydGllcyk7XG5cbiAgICAgICAgdGhpcy5jcmVhdGVPdXRwdXRzKCk7XG4gICAgfVxuICAgIGFkZEZ1bmN0aW9uUGVybWlzc2lvbnMocHJvcGVydGllczogVHJhZmZpY0dlbmVyYXRvckZ1bmN0aW9uUHJvcGVydGllcyk6IHZvaWQge1xuICAgICAgICBpZiAodGhpcy5mdW5jdGlvbikge1xuICAgICAgICAgICAgdGhpcy5mdW5jdGlvbi5yb2xlPy5hZGRNYW5hZ2VkUG9saWN5KFxuICAgICAgICAgICAgICAgIE1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdDbG91ZFdhdGNoTGFtYmRhSW5zaWdodHNFeGVjdXRpb25Sb2xlUG9saWN5JyksXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgdGhpcy5mdW5jdGlvbi5yb2xlPy5hZGRNYW5hZ2VkUG9saWN5KFxuICAgICAgICAgICAgICAgIE1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBuZXcgUG9saWN5KHRoaXMsICdUcmFmZmljR2VuZXJhdG9yUG9saWN5Jywge1xuICAgICAgICAgICAgICAgIHBvbGljeU5hbWU6ICdUcmFmZmljR2VuZXJhdG9yUG9saWN5JyxcbiAgICAgICAgICAgICAgICBkb2N1bWVudDogbmV3IFBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogWydsYW1iZGE6SW52b2tlRnVuY3Rpb24nXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtwcm9wZXJ0aWVzLnBldHNpdGVUcmFmZmljRnVuY3Rpb24uZnVuY3Rpb25Bcm5dLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgcm9sZXM6IFt0aGlzLmZ1bmN0aW9uLnJvbGUhXSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICAgICAgdGhpcy5mdW5jdGlvbi5yb2xlISxcbiAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnTWFuYWdlZCBQb2xpY2llcyBhcmUgYWNjZXB0YWJsZSBmb3IgdGhlIHRhc2sgcm9sZScsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnUGVybWlzc2lvbnMgYXJlIGFjY2VwdGFibGUgZm9yIHRoZSB0YXNrIHJvbGUnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgY3JlYXRlT3V0cHV0cygpOiB2b2lkIHt9XG4gICAgZ2V0RW52aXJvbm1lbnRWYXJpYWJsZXMocHJvcGVydGllczogVHJhZmZpY0dlbmVyYXRvckZ1bmN0aW9uUHJvcGVydGllcyk6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0gfCB1bmRlZmluZWQge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgUEVUU0lURV9UUkFGRklDX0ZVTkNUSU9OX0FSTjogcHJvcGVydGllcy5wZXRzaXRlVHJhZmZpY0Z1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGdldEJ1bmRsaW5nKCk6IEJ1bmRsaW5nT3B0aW9ucyB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtdLFxuICAgICAgICAgICAgbm9kZU1vZHVsZXM6IFsnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSddLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGdldExheWVycygpOiBJTGF5ZXJWZXJzaW9uW10ge1xuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgTGF5ZXJWZXJzaW9uLmZyb21MYXllclZlcnNpb25Bcm4oXG4gICAgICAgICAgICAgICAgdGhpcyxcbiAgICAgICAgICAgICAgICAnTGFtYmRhSW5zaWdodHNMYXllcicsXG4gICAgICAgICAgICAgICAgZ2V0TGFtYmRhSW5zaWdodHNMYXllckFybihTdGFjay5vZih0aGlzKS5yZWdpb24pLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgXTtcbiAgICB9XG59XG4iXX0=