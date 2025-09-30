"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenSearchApplication = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_opensearchservice_1 = require("aws-cdk-lib/aws-opensearchservice");
const constructs_1 = require("constructs");
const constants_1 = require("../../bin/constants");
const utilities_1 = require("../utils/utilities");
const environment_1 = require("../../bin/environment");
/**
 * AWS CDK Construct that creates OpenSearch UI Application for pet adoption data visualization
 * @class OpenSearchApplication
 * @extends Construct
 */
class OpenSearchApplication extends constructs_1.Construct {
    /**
     * Creates a new OpenSearchApplication construct with UI application
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (required)
     */
    constructor(scope, id, properties) {
        super(scope, id);
        const applicationName = properties.applicationName || 'petadoption-opensearch-ui';
        const collection = properties.collection;
        // Create the OpenSearch UI Application
        this.application = new aws_opensearchservice_1.CfnApplication(this, 'Application', {
            name: applicationName,
            appConfigs: [
                {
                    key: 'opensearchDashboards.dashboardAdmin.users',
                    value: '*',
                },
            ],
            dataSources: [
                {
                    dataSourceArn: collection.collection.attrArn,
                },
            ],
            iamIdentityCenterOptions: properties.iamIdentityCenterOptions || {
                enabled: false,
            },
        });
        // Add dependency to ensure collection is created before application
        this.application.addDependency(collection.collection);
        this.application.addDependency(collection.accessPolicy);
        this.createExports();
        this.createOutputs();
    }
    createExports() {
        new aws_cdk_lib_1.CfnOutput(this, 'ApplicationArn', {
            value: this.application.attrArn,
            exportName: constants_1.OPENSEARCH_APPLICATION_ARN_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'ApplicationId', {
            value: this.application.attrId,
            exportName: constants_1.OPENSEARCH_APPLICATION_ID_EXPORT_NAME,
        });
    }
    static importFromExports() {
        const applicationArn = aws_cdk_lib_1.Fn.importValue(constants_1.OPENSEARCH_APPLICATION_ARN_EXPORT_NAME);
        const applicationId = aws_cdk_lib_1.Fn.importValue(constants_1.OPENSEARCH_APPLICATION_ID_EXPORT_NAME);
        return {
            applicationArn,
            applicationId,
        };
    }
    createOutputs() {
        if (this.application) {
            utilities_1.Utilities.createSsmParameters(this, environment_1.PARAMETER_STORE_PREFIX, new Map(Object.entries({
                opensearchapplicationarn: this.application.attrArn,
                opensearchapplicationid: this.application.attrId,
            })));
        }
        else {
            throw new Error('OpenSearch Ui is not available');
        }
    }
}
exports.OpenSearchApplication = OpenSearchApplication;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlbnNlYXJjaC1hcHBsaWNhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9wZW5zZWFyY2gtYXBwbGljYXRpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUE7OztFQUdFO0FBQ0YsNkNBQTRDO0FBQzVDLDZFQUFtRTtBQUNuRSwyQ0FBdUM7QUFDdkMsbURBQW9IO0FBRXBILGtEQUErQztBQUMvQyx1REFBK0Q7QUErQi9EOzs7O0dBSUc7QUFDSCxNQUFhLHFCQUFzQixTQUFRLHNCQUFTO0lBYWhEOzs7OztPQUtHO0lBQ0gsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUEyQztRQUNqRixLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQyxlQUFlLElBQUksMkJBQTJCLENBQUM7UUFDbEYsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLFVBQVUsQ0FBQztRQUV6Qyx1Q0FBdUM7UUFDdkMsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLHNDQUFjLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUN2RCxJQUFJLEVBQUUsZUFBZTtZQUNyQixVQUFVLEVBQUU7Z0JBQ1I7b0JBQ0ksR0FBRyxFQUFFLDJDQUEyQztvQkFDaEQsS0FBSyxFQUFFLEdBQUc7aUJBQ2I7YUFDSjtZQUNELFdBQVcsRUFBRTtnQkFDVDtvQkFDSSxhQUFhLEVBQUUsVUFBVSxDQUFDLFVBQVUsQ0FBQyxPQUFPO2lCQUMvQzthQUNKO1lBQ0Qsd0JBQXdCLEVBQUUsVUFBVSxDQUFDLHdCQUF3QixJQUFJO2dCQUM3RCxPQUFPLEVBQUUsS0FBSzthQUNqQjtTQUNKLENBQUMsQ0FBQztRQUVILG9FQUFvRTtRQUNwRSxJQUFJLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDdEQsSUFBSSxDQUFDLFdBQVcsQ0FBQyxhQUFhLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRXhELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNyQixJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVPLGFBQWE7UUFDakIsSUFBSSx1QkFBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNsQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPO1lBQy9CLFVBQVUsRUFBRSxrREFBc0M7U0FDckQsQ0FBQyxDQUFDO1FBRUgsSUFBSSx1QkFBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDakMsS0FBSyxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTTtZQUM5QixVQUFVLEVBQUUsaURBQXFDO1NBQ3BELENBQUMsQ0FBQztJQUNQLENBQUM7SUFFTSxNQUFNLENBQUMsaUJBQWlCO1FBSTNCLE1BQU0sY0FBYyxHQUFHLGdCQUFFLENBQUMsV0FBVyxDQUFDLGtEQUFzQyxDQUFDLENBQUM7UUFDOUUsTUFBTSxhQUFhLEdBQUcsZ0JBQUUsQ0FBQyxXQUFXLENBQUMsaURBQXFDLENBQUMsQ0FBQztRQUU1RSxPQUFPO1lBQ0gsY0FBYztZQUNkLGFBQWE7U0FDaEIsQ0FBQztJQUNOLENBQUM7SUFFRCxhQUFhO1FBQ1QsSUFBSSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDbkIscUJBQVMsQ0FBQyxtQkFBbUIsQ0FDekIsSUFBSSxFQUNKLG9DQUFzQixFQUN0QixJQUFJLEdBQUcsQ0FDSCxNQUFNLENBQUMsT0FBTyxDQUFDO2dCQUNYLHdCQUF3QixFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsT0FBTztnQkFDbEQsdUJBQXVCLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxNQUFNO2FBQ25ELENBQUMsQ0FDTCxDQUNKLENBQUM7UUFDTixDQUFDO2FBQU0sQ0FBQztZQUNKLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0NBQWdDLENBQUMsQ0FBQztRQUN0RCxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBN0ZELHNEQTZGQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5Db3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cblNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG4qL1xuaW1wb3J0IHsgQ2ZuT3V0cHV0LCBGbiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENmbkFwcGxpY2F0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLW9wZW5zZWFyY2hzZXJ2aWNlJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgT1BFTlNFQVJDSF9BUFBMSUNBVElPTl9BUk5fRVhQT1JUX05BTUUsIE9QRU5TRUFSQ0hfQVBQTElDQVRJT05fSURfRVhQT1JUX05BTUUgfSBmcm9tICcuLi8uLi9iaW4vY29uc3RhbnRzJztcbmltcG9ydCB7IE9wZW5TZWFyY2hDb2xsZWN0aW9uIH0gZnJvbSAnLi9vcGVuc2VhcmNoLWNvbGxlY3Rpb24nO1xuaW1wb3J0IHsgVXRpbGl0aWVzIH0gZnJvbSAnLi4vdXRpbHMvdXRpbGl0aWVzJztcbmltcG9ydCB7IFBBUkFNRVRFUl9TVE9SRV9QUkVGSVggfSBmcm9tICcuLi8uLi9iaW4vZW52aXJvbm1lbnQnO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIGNvbmZpZ3VyaW5nIE9wZW5TZWFyY2hBcHBsaWNhdGlvbiBjb25zdHJ1Y3RcbiAqIEBpbnRlcmZhY2UgT3BlblNlYXJjaEFwcGxpY2F0aW9uUHJvcGVydGllc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIE9wZW5TZWFyY2hBcHBsaWNhdGlvblByb3BlcnRpZXMge1xuICAgIC8qKlxuICAgICAqIE5hbWUgb2YgdGhlIE9wZW5TZWFyY2ggVUkgQXBwbGljYXRpb25cbiAgICAgKiBAZGVmYXVsdCAncGV0YWRvcHRpb24tdWktYXBwJ1xuICAgICAqL1xuICAgIGFwcGxpY2F0aW9uTmFtZT86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBUaGUgT3BlblNlYXJjaCBjb2xsZWN0aW9uIHRvIHVzZSBhcyBkYXRhIHNvdXJjZVxuICAgICAqL1xuICAgIGNvbGxlY3Rpb246IE9wZW5TZWFyY2hDb2xsZWN0aW9uO1xuICAgIC8qKlxuICAgICAqIEFwcGxpY2F0aW9uIGNvbmZpZ3VyYXRpb24gc2V0dGluZ3NcbiAgICAgKiBAb3B0aW9uYWxcbiAgICAgKi9cbiAgICBhcHBDb25maWc/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9O1xuICAgIC8qKlxuICAgICAqIElBTSBJZGVudGl0eSBDZW50ZXIgb3B0aW9uc1xuICAgICAqIEBvcHRpb25hbFxuICAgICAqL1xuICAgIGlhbUlkZW50aXR5Q2VudGVyT3B0aW9ucz86IHtcbiAgICAgICAgZW5hYmxlZD86IGJvb2xlYW47XG4gICAgICAgIGlkZW50aXR5U3RvcmVJZD86IHN0cmluZztcbiAgICB9O1xufVxuXG4vKipcbiAqIEFXUyBDREsgQ29uc3RydWN0IHRoYXQgY3JlYXRlcyBPcGVuU2VhcmNoIFVJIEFwcGxpY2F0aW9uIGZvciBwZXQgYWRvcHRpb24gZGF0YSB2aXN1YWxpemF0aW9uXG4gKiBAY2xhc3MgT3BlblNlYXJjaEFwcGxpY2F0aW9uXG4gKiBAZXh0ZW5kcyBDb25zdHJ1Y3RcbiAqL1xuZXhwb3J0IGNsYXNzIE9wZW5TZWFyY2hBcHBsaWNhdGlvbiBleHRlbmRzIENvbnN0cnVjdCB7XG4gICAgLyoqXG4gICAgICogVGhlIE9wZW5TZWFyY2ggVUkgQXBwbGljYXRpb24gZm9yIHZpc3VhbGl6aW5nIHBldCBhZG9wdGlvbiBkYXRhXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIHB1YmxpYyBhcHBsaWNhdGlvbjogQ2ZuQXBwbGljYXRpb247XG5cbiAgICAvKipcbiAgICAgKiBUaGUgYXBwbGljYXRpb24gZW5kcG9pbnQgVVJMXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIHB1YmxpYyBhcHBsaWNhdGlvbkVuZHBvaW50OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IE9wZW5TZWFyY2hBcHBsaWNhdGlvbiBjb25zdHJ1Y3Qgd2l0aCBVSSBhcHBsaWNhdGlvblxuICAgICAqIEBwYXJhbSBzY29wZSAtIFRoZSBwYXJlbnQgY29uc3RydWN0XG4gICAgICogQHBhcmFtIGlkIC0gVGhlIGNvbnN0cnVjdCBJRFxuICAgICAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQ29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgY29uc3RydWN0IChyZXF1aXJlZClcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBPcGVuU2VhcmNoQXBwbGljYXRpb25Qcm9wZXJ0aWVzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICAgICAgY29uc3QgYXBwbGljYXRpb25OYW1lID0gcHJvcGVydGllcy5hcHBsaWNhdGlvbk5hbWUgfHwgJ3BldGFkb3B0aW9uLW9wZW5zZWFyY2gtdWknO1xuICAgICAgICBjb25zdCBjb2xsZWN0aW9uID0gcHJvcGVydGllcy5jb2xsZWN0aW9uO1xuXG4gICAgICAgIC8vIENyZWF0ZSB0aGUgT3BlblNlYXJjaCBVSSBBcHBsaWNhdGlvblxuICAgICAgICB0aGlzLmFwcGxpY2F0aW9uID0gbmV3IENmbkFwcGxpY2F0aW9uKHRoaXMsICdBcHBsaWNhdGlvbicsIHtcbiAgICAgICAgICAgIG5hbWU6IGFwcGxpY2F0aW9uTmFtZSxcbiAgICAgICAgICAgIGFwcENvbmZpZ3M6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGtleTogJ29wZW5zZWFyY2hEYXNoYm9hcmRzLmRhc2hib2FyZEFkbWluLnVzZXJzJyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6ICcqJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGRhdGFTb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBkYXRhU291cmNlQXJuOiBjb2xsZWN0aW9uLmNvbGxlY3Rpb24uYXR0ckFybixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGlhbUlkZW50aXR5Q2VudGVyT3B0aW9uczogcHJvcGVydGllcy5pYW1JZGVudGl0eUNlbnRlck9wdGlvbnMgfHwge1xuICAgICAgICAgICAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQWRkIGRlcGVuZGVuY3kgdG8gZW5zdXJlIGNvbGxlY3Rpb24gaXMgY3JlYXRlZCBiZWZvcmUgYXBwbGljYXRpb25cbiAgICAgICAgdGhpcy5hcHBsaWNhdGlvbi5hZGREZXBlbmRlbmN5KGNvbGxlY3Rpb24uY29sbGVjdGlvbik7XG4gICAgICAgIHRoaXMuYXBwbGljYXRpb24uYWRkRGVwZW5kZW5jeShjb2xsZWN0aW9uLmFjY2Vzc1BvbGljeSk7XG5cbiAgICAgICAgdGhpcy5jcmVhdGVFeHBvcnRzKCk7XG4gICAgICAgIHRoaXMuY3JlYXRlT3V0cHV0cygpO1xuICAgIH1cblxuICAgIHByaXZhdGUgY3JlYXRlRXhwb3J0cygpOiB2b2lkIHtcbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQXBwbGljYXRpb25Bcm4nLCB7XG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5hcHBsaWNhdGlvbi5hdHRyQXJuLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogT1BFTlNFQVJDSF9BUFBMSUNBVElPTl9BUk5fRVhQT1JUX05BTUUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ0FwcGxpY2F0aW9uSWQnLCB7XG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5hcHBsaWNhdGlvbi5hdHRySWQsXG4gICAgICAgICAgICBleHBvcnROYW1lOiBPUEVOU0VBUkNIX0FQUExJQ0FUSU9OX0lEX0VYUE9SVF9OQU1FLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwdWJsaWMgc3RhdGljIGltcG9ydEZyb21FeHBvcnRzKCk6IHtcbiAgICAgICAgYXBwbGljYXRpb25Bcm46IHN0cmluZztcbiAgICAgICAgYXBwbGljYXRpb25JZDogc3RyaW5nO1xuICAgIH0ge1xuICAgICAgICBjb25zdCBhcHBsaWNhdGlvbkFybiA9IEZuLmltcG9ydFZhbHVlKE9QRU5TRUFSQ0hfQVBQTElDQVRJT05fQVJOX0VYUE9SVF9OQU1FKTtcbiAgICAgICAgY29uc3QgYXBwbGljYXRpb25JZCA9IEZuLmltcG9ydFZhbHVlKE9QRU5TRUFSQ0hfQVBQTElDQVRJT05fSURfRVhQT1JUX05BTUUpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBhcHBsaWNhdGlvbkFybixcbiAgICAgICAgICAgIGFwcGxpY2F0aW9uSWQsXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgY3JlYXRlT3V0cHV0cygpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMuYXBwbGljYXRpb24pIHtcbiAgICAgICAgICAgIFV0aWxpdGllcy5jcmVhdGVTc21QYXJhbWV0ZXJzKFxuICAgICAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICAgICAgUEFSQU1FVEVSX1NUT1JFX1BSRUZJWCxcbiAgICAgICAgICAgICAgICBuZXcgTWFwKFxuICAgICAgICAgICAgICAgICAgICBPYmplY3QuZW50cmllcyh7XG4gICAgICAgICAgICAgICAgICAgICAgICBvcGVuc2VhcmNoYXBwbGljYXRpb25hcm46IHRoaXMuYXBwbGljYXRpb24uYXR0ckFybixcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5zZWFyY2hhcHBsaWNhdGlvbmlkOiB0aGlzLmFwcGxpY2F0aW9uLmF0dHJJZCxcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ09wZW5TZWFyY2ggVWkgaXMgbm90IGF2YWlsYWJsZScpO1xuICAgICAgICB9XG4gICAgfVxufVxuIl19