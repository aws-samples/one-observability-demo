"use strict";
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudWatchTransactionSearch = void 0;
/**
 * CloudWatch construct for the One Observability Workshop.
 *
 * This module provides CloudWatch settings configuration.
 *
 * @packageDocumentation
 */
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_xray_1 = require("aws-cdk-lib/aws-xray");
const environment_1 = require("../../bin/environment");
/**
 * A CDK construct that creates CloudWatch Transaction Search configuration
 * with CloudWatch logs resource policy for the observability workshop.
 */
class CloudWatchTransactionSearch extends constructs_1.Construct {
    /**
     * Creates a new CloudWatch TransactionSearch construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for CloudWatch Transaction Search
     */
    constructor(scope, id, properties) {
        super(scope, id);
        const stack = aws_cdk_lib_1.Stack.of(this);
        if (environment_1.AUTO_TRANSACTION_SEARCH_CONFIGURED) {
            aws_cdk_lib_1.Annotations.of(this).addInfo('Transaction search is already configured in the account. Skipping setup.');
        }
        else {
            // CloudWatch Transaction Search setup
            this.resourcePolicy = new aws_logs_1.CfnResourcePolicy(this, 'TransactionSearchLogResourcePolicy', {
                policyName: 'TransactionSearchAccess',
                policyDocument: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Sid: 'TransactionSearchXRayAccess',
                            Effect: 'Allow',
                            Principal: {
                                Service: 'xray.amazonaws.com',
                            },
                            Action: 'logs:PutLogEvents',
                            Resource: [
                                `arn:${stack.partition}:logs:${stack.region}:${stack.account}:log-group:aws/spans:*`,
                                `arn:${stack.partition}:logs:${stack.region}:${stack.account}:log-group:/aws/application-signals/data:*`,
                            ],
                            Condition: {
                                ArnLike: {
                                    'aws:SourceArn': `arn:${stack.partition}:xray:${stack.region}:${stack.account}:*`,
                                },
                                StringEquals: {
                                    'aws:SourceAccount': stack.account,
                                },
                            },
                        },
                    ],
                }),
            });
            this.transactionSearchConfig = new aws_xray_1.CfnTransactionSearchConfig(this, 'TransactionSearchConfig', {
                indexingPercentage: properties?.indexingPercentage || 1,
            });
            this.transactionSearchConfig.addDependency(this.resourcePolicy);
        }
    }
}
exports.CloudWatchTransactionSearch = CloudWatchTransactionSearch;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWR3YXRjaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNsb3Vkd2F0Y2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7RUFHRTs7O0FBRUY7Ozs7OztHQU1HO0FBRUgsMkNBQXVDO0FBQ3ZDLDZDQUFpRDtBQUNqRCxtREFBeUQ7QUFDekQsbURBQWtFO0FBQ2xFLHVEQUEyRTtBQVUzRTs7O0dBR0c7QUFDSCxNQUFhLDJCQUE0QixTQUFRLHNCQUFTO0lBTXREOzs7Ozs7T0FNRztJQUNILFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsVUFBa0Q7UUFDeEYsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEtBQUssR0FBRyxtQkFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUU3QixJQUFJLGdEQUFrQyxFQUFFLENBQUM7WUFDckMseUJBQVcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLDBFQUEwRSxDQUFDLENBQUM7UUFDN0csQ0FBQzthQUFNLENBQUM7WUFDSixzQ0FBc0M7WUFDdEMsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLDRCQUFpQixDQUFDLElBQUksRUFBRSxvQ0FBb0MsRUFBRTtnQkFDcEYsVUFBVSxFQUFFLHlCQUF5QjtnQkFDckMsY0FBYyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQzNCLE9BQU8sRUFBRSxZQUFZO29CQUNyQixTQUFTLEVBQUU7d0JBQ1A7NEJBQ0ksR0FBRyxFQUFFLDZCQUE2Qjs0QkFDbEMsTUFBTSxFQUFFLE9BQU87NEJBQ2YsU0FBUyxFQUFFO2dDQUNQLE9BQU8sRUFBRSxvQkFBb0I7NkJBQ2hDOzRCQUNELE1BQU0sRUFBRSxtQkFBbUI7NEJBQzNCLFFBQVEsRUFBRTtnQ0FDTixPQUFPLEtBQUssQ0FBQyxTQUFTLFNBQVMsS0FBSyxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyx3QkFBd0I7Z0NBQ3BGLE9BQU8sS0FBSyxDQUFDLFNBQVMsU0FBUyxLQUFLLENBQUMsTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLDRDQUE0Qzs2QkFDM0c7NEJBQ0QsU0FBUyxFQUFFO2dDQUNQLE9BQU8sRUFBRTtvQ0FDTCxlQUFlLEVBQUUsT0FBTyxLQUFLLENBQUMsU0FBUyxTQUFTLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sSUFBSTtpQ0FDcEY7Z0NBQ0QsWUFBWSxFQUFFO29DQUNWLG1CQUFtQixFQUFFLEtBQUssQ0FBQyxPQUFPO2lDQUNyQzs2QkFDSjt5QkFDSjtxQkFDSjtpQkFDSixDQUFDO2FBQ0wsQ0FBQyxDQUFDO1lBRUgsSUFBSSxDQUFDLHVCQUF1QixHQUFHLElBQUkscUNBQTBCLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO2dCQUMzRixrQkFBa0IsRUFBRSxVQUFVLEVBQUUsa0JBQWtCLElBQUksQ0FBQzthQUMxRCxDQUFDLENBQUM7WUFFSCxJQUFJLENBQUMsdUJBQXVCLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNwRSxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBMURELGtFQTBEQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5Db3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cblNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG4qL1xuXG4vKipcbiAqIENsb3VkV2F0Y2ggY29uc3RydWN0IGZvciB0aGUgT25lIE9ic2VydmFiaWxpdHkgV29ya3Nob3AuXG4gKlxuICogVGhpcyBtb2R1bGUgcHJvdmlkZXMgQ2xvdWRXYXRjaCBzZXR0aW5ncyBjb25maWd1cmF0aW9uLlxuICpcbiAqIEBwYWNrYWdlRG9jdW1lbnRhdGlvblxuICovXG5cbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQW5ub3RhdGlvbnMsIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ2ZuUmVzb3VyY2VQb2xpY3kgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDZm5UcmFuc2FjdGlvblNlYXJjaENvbmZpZyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy14cmF5JztcbmltcG9ydCB7IEFVVE9fVFJBTlNBQ1RJT05fU0VBUkNIX0NPTkZJR1VSRUQgfSBmcm9tICcuLi8uLi9iaW4vZW52aXJvbm1lbnQnO1xuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gcHJvcGVydGllcyBmb3IgdGhlIENsb3VkV2F0Y2hUcmFuc2FjdGlvblNlYXJjaCBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2xvdWRXYXRjaFRyYW5zYWN0aW9uU2VhcmNoUHJvcGVydGllcyB7XG4gICAgLyoqIEluZGV4aW5nIHBlcmNlbnRhZ2UgZm9yIHRyYW5zYWN0aW9uIHNlYXJjaCAoMC0xMDApICovXG4gICAgaW5kZXhpbmdQZXJjZW50YWdlPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEEgQ0RLIGNvbnN0cnVjdCB0aGF0IGNyZWF0ZXMgQ2xvdWRXYXRjaCBUcmFuc2FjdGlvbiBTZWFyY2ggY29uZmlndXJhdGlvblxuICogd2l0aCBDbG91ZFdhdGNoIGxvZ3MgcmVzb3VyY2UgcG9saWN5IGZvciB0aGUgb2JzZXJ2YWJpbGl0eSB3b3Jrc2hvcC5cbiAqL1xuZXhwb3J0IGNsYXNzIENsb3VkV2F0Y2hUcmFuc2FjdGlvblNlYXJjaCBleHRlbmRzIENvbnN0cnVjdCB7XG4gICAgLyoqIFRoZSBDbG91ZFdhdGNoIHJlc291cmNlIHBvbGljeSBmb3IgWC1SYXkgYWNjZXNzICovXG4gICAgcHVibGljIHJlYWRvbmx5IHJlc291cmNlUG9saWN5OiBDZm5SZXNvdXJjZVBvbGljeTtcbiAgICAvKiogVGhlIFgtUmF5IHRyYW5zYWN0aW9uIHNlYXJjaCBjb25maWd1cmF0aW9uICovXG4gICAgcHVibGljIHJlYWRvbmx5IHRyYW5zYWN0aW9uU2VhcmNoQ29uZmlnOiBDZm5UcmFuc2FjdGlvblNlYXJjaENvbmZpZztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgQ2xvdWRXYXRjaCBUcmFuc2FjdGlvblNlYXJjaCBjb25zdHJ1Y3QuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gc2NvcGUgLSBUaGUgcGFyZW50IGNvbnN0cnVjdFxuICAgICAqIEBwYXJhbSBpZCAtIFRoZSBjb25zdHJ1Y3QgaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQ29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzIGZvciBDbG91ZFdhdGNoIFRyYW5zYWN0aW9uIFNlYXJjaFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BlcnRpZXM/OiBDbG91ZFdhdGNoVHJhbnNhY3Rpb25TZWFyY2hQcm9wZXJ0aWVzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICAgICAgY29uc3Qgc3RhY2sgPSBTdGFjay5vZih0aGlzKTtcblxuICAgICAgICBpZiAoQVVUT19UUkFOU0FDVElPTl9TRUFSQ0hfQ09ORklHVVJFRCkge1xuICAgICAgICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkSW5mbygnVHJhbnNhY3Rpb24gc2VhcmNoIGlzIGFscmVhZHkgY29uZmlndXJlZCBpbiB0aGUgYWNjb3VudC4gU2tpcHBpbmcgc2V0dXAuJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBDbG91ZFdhdGNoIFRyYW5zYWN0aW9uIFNlYXJjaCBzZXR1cFxuICAgICAgICAgICAgdGhpcy5yZXNvdXJjZVBvbGljeSA9IG5ldyBDZm5SZXNvdXJjZVBvbGljeSh0aGlzLCAnVHJhbnNhY3Rpb25TZWFyY2hMb2dSZXNvdXJjZVBvbGljeScsIHtcbiAgICAgICAgICAgICAgICBwb2xpY3lOYW1lOiAnVHJhbnNhY3Rpb25TZWFyY2hBY2Nlc3MnLFxuICAgICAgICAgICAgICAgIHBvbGljeURvY3VtZW50OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgICAgICAgICAgICAgICAgICAgU3RhdGVtZW50OiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgU2lkOiAnVHJhbnNhY3Rpb25TZWFyY2hYUmF5QWNjZXNzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUHJpbmNpcGFsOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNlcnZpY2U6ICd4cmF5LmFtYXpvbmF3cy5jb20nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgQWN0aW9uOiAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlc291cmNlOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBhcm46JHtzdGFjay5wYXJ0aXRpb259OmxvZ3M6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06bG9nLWdyb3VwOmF3cy9zcGFuczoqYCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYGFybjoke3N0YWNrLnBhcnRpdGlvbn06bG9nczoke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9hcHBsaWNhdGlvbi1zaWduYWxzL2RhdGE6KmAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBDb25kaXRpb246IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgQXJuTGlrZToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2F3czpTb3VyY2VBcm4nOiBgYXJuOiR7c3RhY2sucGFydGl0aW9ufTp4cmF5OiR7c3RhY2sucmVnaW9ufToke3N0YWNrLmFjY291bnR9OipgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdhd3M6U291cmNlQWNjb3VudCc6IHN0YWNrLmFjY291bnQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy50cmFuc2FjdGlvblNlYXJjaENvbmZpZyA9IG5ldyBDZm5UcmFuc2FjdGlvblNlYXJjaENvbmZpZyh0aGlzLCAnVHJhbnNhY3Rpb25TZWFyY2hDb25maWcnLCB7XG4gICAgICAgICAgICAgICAgaW5kZXhpbmdQZXJjZW50YWdlOiBwcm9wZXJ0aWVzPy5pbmRleGluZ1BlcmNlbnRhZ2UgfHwgMSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0aGlzLnRyYW5zYWN0aW9uU2VhcmNoQ29uZmlnLmFkZERlcGVuZGVuY3kodGhpcy5yZXNvdXJjZVBvbGljeSk7XG4gICAgICAgIH1cbiAgICB9XG59XG4iXX0=