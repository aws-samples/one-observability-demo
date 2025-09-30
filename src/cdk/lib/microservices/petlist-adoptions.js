"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListAdoptionsService = void 0;
const ecs_service_1 = require("../constructs/ecs-service");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const environment_1 = require("../../bin/environment");
const constants_1 = require("../../bin/constants");
const cdk_nag_1 = require("cdk-nag");
const utilities_1 = require("../utils/utilities");
const aws_applicationsignals_alpha_1 = require("@aws-cdk/aws-applicationsignals-alpha");
class ListAdoptionsService extends ecs_service_1.EcsService {
    constructor(scope, id, properties) {
        super(scope, id, properties);
        new aws_applicationsignals_alpha_1.ApplicationSignalsIntegration(this, 'petlist-integration', {
            taskDefinition: this.taskDefinition,
            instrumentation: {
                sdkVersion: aws_applicationsignals_alpha_1.PythonInstrumentationVersion.V0_9_0,
            },
            serviceName: `${properties.name}-Service`,
            cloudWatchAgentSidecar: {
                containerName: 'ecs-cwagent',
                enableLogging: true,
                cpu: 256,
                memoryLimitMiB: 512,
            },
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.taskDefinition, [
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
        ], true);
        utilities_1.Utilities.TagConstruct(this, {
            'app:owner': 'petstore',
            'app:project': 'workshop',
            'app:name': properties.name,
            'app:computType': properties.computeType,
            'app:hostType:': properties.hostType,
        });
    }
    addPermissions(properties) {
        properties.secret?.grantRead(this.taskRole);
        this.taskRole.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
        this.taskRole.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));
        const taskPolicy = new aws_iam_1.Policy(this, 'taskPolicy', {
            policyName: 'ListdoptionTaskPolicy',
            document: new aws_iam_1.PolicyDocument({
                statements: [ecs_service_1.EcsService.getDefaultSSMPolicy(this, environment_1.PARAMETER_STORE_PREFIX)],
            }),
            roles: [this.taskRole],
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(taskPolicy, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Managed Policies are acceptable for the task role',
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Permissions are acceptable for the task role',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.taskRole, [
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
    createOutputs(properties) {
        if (!this.loadBalancedService && !properties.disableService) {
            throw new Error('Service is not defined');
        }
        else {
            utilities_1.Utilities.createSsmParameters(this, environment_1.PARAMETER_STORE_PREFIX, new Map(Object.entries({
                [constants_1.SSM_PARAMETER_NAMES.PET_LIST_ADOPTIONS_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/api/adoptionlist/`,
                [constants_1.SSM_PARAMETER_NAMES.PET_LIST_ADOPTIONS_METRICS_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/metrics`,
            })));
        }
    }
}
exports.ListAdoptionsService = ListAdoptionsService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGV0bGlzdC1hZG9wdGlvbnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwZXRsaXN0LWFkb3B0aW9ucy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFLQSwyREFBNkU7QUFHN0UsaURBQTRFO0FBQzVFLHVEQUErRDtBQUMvRCxtREFBMEQ7QUFDMUQscUNBQTBDO0FBQzFDLGtEQUErQztBQUMvQyx3RkFBb0g7QUFPcEgsTUFBYSxvQkFBcUIsU0FBUSx3QkFBVTtJQUNoRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFVBQTBDO1FBQ2hGLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRTdCLElBQUksNERBQTZCLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzNELGNBQWMsRUFBRSxJQUFJLENBQUMsY0FBYztZQUNuQyxlQUFlLEVBQUU7Z0JBQ2IsVUFBVSxFQUFFLDJEQUE0QixDQUFDLE1BQU07YUFDbEQ7WUFDRCxXQUFXLEVBQUUsR0FBRyxVQUFVLENBQUMsSUFBSSxVQUFVO1lBQ3pDLHNCQUFzQixFQUFFO2dCQUNwQixhQUFhLEVBQUUsYUFBYTtnQkFDNUIsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLEdBQUcsRUFBRSxHQUFHO2dCQUNSLGNBQWMsRUFBRSxHQUFHO2FBQ3RCO1NBQ0osQ0FBQyxDQUFDO1FBRUgseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDbkMsSUFBSSxDQUFDLGNBQWMsRUFDbkI7WUFDSTtnQkFDSSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsbUZBQW1GO2FBQzlGO1lBQ0Q7Z0JBQ0ksRUFBRSxFQUFFLGVBQWU7Z0JBQ25CLE1BQU0sRUFBRSwwREFBMEQ7YUFDckU7WUFDRDtnQkFDSSxFQUFFLEVBQUUsZUFBZTtnQkFDbkIsTUFBTSxFQUFFLDBEQUEwRDthQUNyRTtTQUNKLEVBQ0QsSUFBSSxDQUNQLENBQUM7UUFFRixxQkFBUyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUU7WUFDekIsV0FBVyxFQUFFLFVBQVU7WUFDdkIsYUFBYSxFQUFFLFVBQVU7WUFDekIsVUFBVSxFQUFFLFVBQVUsQ0FBQyxJQUFJO1lBQzNCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxXQUFXO1lBQ3hDLGVBQWUsRUFBRSxVQUFVLENBQUMsUUFBUTtTQUN2QyxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsY0FBYyxDQUFDLFVBQTBDO1FBQ3JELFVBQVUsQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUU1QyxJQUFJLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUMxQix1QkFBYSxDQUFDLHdCQUF3QixDQUFDLCtDQUErQyxDQUFDLENBQzFGLENBQUM7UUFFRixJQUFJLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLHVCQUFhLENBQUMsd0JBQXdCLENBQUMsMEJBQTBCLENBQUMsQ0FBQyxDQUFDO1FBRW5HLE1BQU0sVUFBVSxHQUFHLElBQUksZ0JBQU0sQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQzlDLFVBQVUsRUFBRSx1QkFBdUI7WUFDbkMsUUFBUSxFQUFFLElBQUksd0JBQWMsQ0FBQztnQkFDekIsVUFBVSxFQUFFLENBQUMsd0JBQVUsQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLEVBQUUsb0NBQXNCLENBQUMsQ0FBQzthQUM3RSxDQUFDO1lBQ0YsS0FBSyxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztTQUN6QixDQUFDLENBQUM7UUFFSCx5QkFBZSxDQUFDLHVCQUF1QixDQUNuQyxVQUFVLEVBQ1Y7WUFDSTtnQkFDSSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsbURBQW1EO2FBQzlEO1lBQ0Q7Z0JBQ0ksRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLDhDQUE4QzthQUN6RDtTQUNKLEVBQ0QsSUFBSSxDQUNQLENBQUM7UUFFRix5QkFBZSxDQUFDLHVCQUF1QixDQUNuQyxJQUFJLENBQUMsUUFBUSxFQUNiO1lBQ0k7Z0JBQ0ksRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG1EQUFtRDthQUM5RDtZQUNEO2dCQUNJLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSw4Q0FBOEM7YUFDekQ7U0FDSixFQUNELElBQUksQ0FDUCxDQUFDO0lBQ04sQ0FBQztJQUVELGFBQWEsQ0FBQyxVQUEwQztRQUNwRCxJQUFJLENBQUMsSUFBSSxDQUFDLG1CQUFtQixJQUFJLENBQUMsVUFBVSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQzFELE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUM5QyxDQUFDO2FBQU0sQ0FBQztZQUNKLHFCQUFTLENBQUMsbUJBQW1CLENBQ3pCLElBQUksRUFDSixvQ0FBc0IsRUFDdEIsSUFBSSxHQUFHLENBQ0gsTUFBTSxDQUFDLE9BQU8sQ0FBQztnQkFDWCxDQUFDLCtCQUFtQixDQUFDLHNCQUFzQixDQUFDLEVBQUUsVUFBVSxJQUFJLENBQUMsbUJBQW1CLEVBQUUsWUFBWSxDQUFDLG1CQUFtQixvQkFBb0I7Z0JBQ3RJLENBQUMsK0JBQW1CLENBQUMsOEJBQThCLENBQUMsRUFBRSxVQUFVLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxZQUFZLENBQUMsbUJBQW1CLFVBQVU7YUFDdkksQ0FBQyxDQUNMLENBQ0osQ0FBQztRQUNOLENBQUM7SUFDTCxDQUFDO0NBQ0o7QUE5R0Qsb0RBOEdDIiwic291cmNlc0NvbnRlbnQiOlsiLypcbkNvcHlyaWdodCBBbWF6b24uY29tLCBJbmMuIG9yIGl0cyBhZmZpbGlhdGVzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiovXG5pbXBvcnQgeyBJRGF0YWJhc2VDbHVzdGVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XG5pbXBvcnQgeyBFY3NTZXJ2aWNlLCBFY3NTZXJ2aWNlUHJvcGVydGllcyB9IGZyb20gJy4uL2NvbnN0cnVjdHMvZWNzLXNlcnZpY2UnO1xuaW1wb3J0IHsgSVNlY3JldCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE1hbmFnZWRQb2xpY3ksIFBvbGljeSwgUG9saWN5RG9jdW1lbnQgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IFBBUkFNRVRFUl9TVE9SRV9QUkVGSVggfSBmcm9tICcuLi8uLi9iaW4vZW52aXJvbm1lbnQnO1xuaW1wb3J0IHsgU1NNX1BBUkFNRVRFUl9OQU1FUyB9IGZyb20gJy4uLy4uL2Jpbi9jb25zdGFudHMnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5pbXBvcnQgeyBVdGlsaXRpZXMgfSBmcm9tICcuLi91dGlscy91dGlsaXRpZXMnO1xuaW1wb3J0IHsgQXBwbGljYXRpb25TaWduYWxzSW50ZWdyYXRpb24sIFB5dGhvbkluc3RydW1lbnRhdGlvblZlcnNpb24gfSBmcm9tICdAYXdzLWNkay9hd3MtYXBwbGljYXRpb25zaWduYWxzLWFscGhhJztcblxuZXhwb3J0IGludGVyZmFjZSBMaXN0QWRvcHRpb25zU2VydmljZVByb3BlcnRpZXMgZXh0ZW5kcyBFY3NTZXJ2aWNlUHJvcGVydGllcyB7XG4gICAgZGF0YWJhc2U6IElEYXRhYmFzZUNsdXN0ZXI7XG4gICAgc2VjcmV0OiBJU2VjcmV0O1xufVxuXG5leHBvcnQgY2xhc3MgTGlzdEFkb3B0aW9uc1NlcnZpY2UgZXh0ZW5kcyBFY3NTZXJ2aWNlIHtcbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBMaXN0QWRvcHRpb25zU2VydmljZVByb3BlcnRpZXMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wZXJ0aWVzKTtcblxuICAgICAgICBuZXcgQXBwbGljYXRpb25TaWduYWxzSW50ZWdyYXRpb24odGhpcywgJ3BldGxpc3QtaW50ZWdyYXRpb24nLCB7XG4gICAgICAgICAgICB0YXNrRGVmaW5pdGlvbjogdGhpcy50YXNrRGVmaW5pdGlvbixcbiAgICAgICAgICAgIGluc3RydW1lbnRhdGlvbjoge1xuICAgICAgICAgICAgICAgIHNka1ZlcnNpb246IFB5dGhvbkluc3RydW1lbnRhdGlvblZlcnNpb24uVjBfOV8wLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNlcnZpY2VOYW1lOiBgJHtwcm9wZXJ0aWVzLm5hbWV9LVNlcnZpY2VgLFxuICAgICAgICAgICAgY2xvdWRXYXRjaEFnZW50U2lkZWNhcjoge1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lck5hbWU6ICdlY3MtY3dhZ2VudCcsXG4gICAgICAgICAgICAgICAgZW5hYmxlTG9nZ2luZzogdHJ1ZSxcbiAgICAgICAgICAgICAgICBjcHU6IDI1NixcbiAgICAgICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogNTEyLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgICAgICAgdGhpcy50YXNrRGVmaW5pdGlvbixcbiAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUVDUzcnLFxuICAgICAgICAgICAgICAgICAgICByZWFzb246ICdGYWxzZSBwb3NpdGl2ZSwgdGhlIEFwcGxpY2F0aW9uIFNpZ25hbCBjb250YWluZXIgaGFzIGxvZ2dpbmcgZW5hYmxlZCBhcyBhIHNpZGVjYXInLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ1dvcmtzaG9wLUNXTDEnLFxuICAgICAgICAgICAgICAgICAgICByZWFzb246ICdDbG91ZHdhdGNoIExvZ3MgaXMgbm90IGFuIGV4cG9zZWQgcHJvcGVydHkgZm9yIHRoZSBBbHBoYScsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnV29ya3Nob3AtQ1dMMicsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0Nsb3Vkd2F0Y2ggTG9ncyBpcyBub3QgYW4gZXhwb3NlZCBwcm9wZXJ0eSBmb3IgdGhlIEFscGhhJyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHRydWUsXG4gICAgICAgICk7XG5cbiAgICAgICAgVXRpbGl0aWVzLlRhZ0NvbnN0cnVjdCh0aGlzLCB7XG4gICAgICAgICAgICAnYXBwOm93bmVyJzogJ3BldHN0b3JlJyxcbiAgICAgICAgICAgICdhcHA6cHJvamVjdCc6ICd3b3Jrc2hvcCcsXG4gICAgICAgICAgICAnYXBwOm5hbWUnOiBwcm9wZXJ0aWVzLm5hbWUsXG4gICAgICAgICAgICAnYXBwOmNvbXB1dFR5cGUnOiBwcm9wZXJ0aWVzLmNvbXB1dGVUeXBlLFxuICAgICAgICAgICAgJ2FwcDpob3N0VHlwZTonOiBwcm9wZXJ0aWVzLmhvc3RUeXBlLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBhZGRQZXJtaXNzaW9ucyhwcm9wZXJ0aWVzOiBMaXN0QWRvcHRpb25zU2VydmljZVByb3BlcnRpZXMpOiB2b2lkIHtcbiAgICAgICAgcHJvcGVydGllcy5zZWNyZXQ/LmdyYW50UmVhZCh0aGlzLnRhc2tSb2xlKTtcblxuICAgICAgICB0aGlzLnRhc2tSb2xlLmFkZE1hbmFnZWRQb2xpY3koXG4gICAgICAgICAgICBNYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FtYXpvbkVDU1Rhc2tFeGVjdXRpb25Sb2xlUG9saWN5JyksXG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy50YXNrUm9sZS5hZGRNYW5hZ2VkUG9saWN5KE1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBV1NYUmF5RGFlbW9uV3JpdGVBY2Nlc3MnKSk7XG5cbiAgICAgICAgY29uc3QgdGFza1BvbGljeSA9IG5ldyBQb2xpY3kodGhpcywgJ3Rhc2tQb2xpY3knLCB7XG4gICAgICAgICAgICBwb2xpY3lOYW1lOiAnTGlzdGRvcHRpb25UYXNrUG9saWN5JyxcbiAgICAgICAgICAgIGRvY3VtZW50OiBuZXcgUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgICAgIHN0YXRlbWVudHM6IFtFY3NTZXJ2aWNlLmdldERlZmF1bHRTU01Qb2xpY3kodGhpcywgUEFSQU1FVEVSX1NUT1JFX1BSRUZJWCldLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICByb2xlczogW3RoaXMudGFza1JvbGVdLFxuICAgICAgICB9KTtcblxuICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICB0YXNrUG9saWN5LFxuICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ01hbmFnZWQgUG9saWNpZXMgYXJlIGFjY2VwdGFibGUgZm9yIHRoZSB0YXNrIHJvbGUnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnUGVybWlzc2lvbnMgYXJlIGFjY2VwdGFibGUgZm9yIHRoZSB0YXNrIHJvbGUnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgKTtcblxuICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICB0aGlzLnRhc2tSb2xlLFxuICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ01hbmFnZWQgUG9saWNpZXMgYXJlIGFjY2VwdGFibGUgZm9yIHRoZSB0YXNrIHJvbGUnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnUGVybWlzc2lvbnMgYXJlIGFjY2VwdGFibGUgZm9yIHRoZSB0YXNrIHJvbGUnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBjcmVhdGVPdXRwdXRzKHByb3BlcnRpZXM6IExpc3RBZG9wdGlvbnNTZXJ2aWNlUHJvcGVydGllcyk6IHZvaWQge1xuICAgICAgICBpZiAoIXRoaXMubG9hZEJhbGFuY2VkU2VydmljZSAmJiAhcHJvcGVydGllcy5kaXNhYmxlU2VydmljZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZXJ2aWNlIGlzIG5vdCBkZWZpbmVkJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBVdGlsaXRpZXMuY3JlYXRlU3NtUGFyYW1ldGVycyhcbiAgICAgICAgICAgICAgICB0aGlzLFxuICAgICAgICAgICAgICAgIFBBUkFNRVRFUl9TVE9SRV9QUkVGSVgsXG4gICAgICAgICAgICAgICAgbmV3IE1hcChcbiAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmVudHJpZXMoe1xuICAgICAgICAgICAgICAgICAgICAgICAgW1NTTV9QQVJBTUVURVJfTkFNRVMuUEVUX0xJU1RfQURPUFRJT05TX1VSTF06IGBodHRwOi8vJHt0aGlzLmxvYWRCYWxhbmNlZFNlcnZpY2U/LmxvYWRCYWxhbmNlci5sb2FkQmFsYW5jZXJEbnNOYW1lfS9hcGkvYWRvcHRpb25saXN0L2AsXG4gICAgICAgICAgICAgICAgICAgICAgICBbU1NNX1BBUkFNRVRFUl9OQU1FUy5QRVRfTElTVF9BRE9QVElPTlNfTUVUUklDU19VUkxdOiBgaHR0cDovLyR7dGhpcy5sb2FkQmFsYW5jZWRTZXJ2aWNlPy5sb2FkQmFsYW5jZXIubG9hZEJhbGFuY2VyRG5zTmFtZX0vbWV0cmljc2AsXG4gICAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfVxufVxuIl19