"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkshopNagPack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
/**
 * Custom CDK-nag rule pack for workshop validation.
 * Ensures resources are configured for proper deletion when stack is destroyed.
 */
class WorkshopNagPack extends cdk_nag_1.NagPack {
    constructor(properties) {
        super(properties);
        this.checkCloudWatchLogGroupRetention = (node) => {
            if (node.cfnResourceType === 'AWS::Logs::LogGroup') {
                const retentionProperty = cdk_nag_1.NagRules.resolveIfPrimitive(node, node.retentionInDays);
                if (!retentionProperty) {
                    return cdk_nag_1.NagRuleCompliance.NON_COMPLIANT;
                }
                return cdk_nag_1.NagRuleCompliance.COMPLIANT;
            }
            return cdk_nag_1.NagRuleCompliance.NOT_APPLICABLE;
        };
        this.checkCloudWatchLogGroupDeletion = (node) => {
            if (node.cfnResourceType === 'AWS::Logs::LogGroup') {
                const deletionPolicy = node.cfnOptions.deletionPolicy;
                if (!deletionPolicy || deletionPolicy.toString() !== 'Delete') {
                    return cdk_nag_1.NagRuleCompliance.NON_COMPLIANT;
                }
                return cdk_nag_1.NagRuleCompliance.COMPLIANT;
            }
            return cdk_nag_1.NagRuleCompliance.NOT_APPLICABLE;
        };
        this.checkS3BucketDeletion = (node) => {
            if (node.cfnResourceType === 'AWS::S3::Bucket') {
                const deletionPolicy = node.cfnOptions.deletionPolicy;
                if (!deletionPolicy || deletionPolicy.toString() !== 'Delete') {
                    return cdk_nag_1.NagRuleCompliance.NON_COMPLIANT;
                }
                return cdk_nag_1.NagRuleCompliance.COMPLIANT;
            }
            return cdk_nag_1.NagRuleCompliance.NOT_APPLICABLE;
        };
        this.checkS3BucketAutoDelete = (node) => {
            if (node.cfnResourceType === 'AWS::S3::Bucket') {
                const hasAutoDelete = this.checkForAutoDeleteObjects(node);
                if (!hasAutoDelete) {
                    return cdk_nag_1.NagRuleCompliance.NON_COMPLIANT;
                }
                return cdk_nag_1.NagRuleCompliance.COMPLIANT;
            }
            return cdk_nag_1.NagRuleCompliance.NOT_APPLICABLE;
        };
        this.checkLambdaLogGroupAssociation = (node) => {
            if (node.cfnResourceType === 'AWS::Lambda::Function') {
                // Skip CDK-managed Lambda functions using regex patterns
                const cdkManagedPatterns = [
                    /Custom::/,
                    /LogRetention/,
                    /KubectlProvider/,
                    /ClusterResourceProvider/,
                    /AWSCDKCfnUtilsProviderCustomResourceProvider/,
                ];
                if (cdkManagedPatterns.some((pattern) => pattern.test(node.logicalId))) {
                    return cdk_nag_1.NagRuleCompliance.NOT_APPLICABLE;
                }
                const loggingConfig = node.loggingConfig;
                // Skip validation if loggingConfig contains non-primitive values
                if (loggingConfig &&
                    typeof loggingConfig === 'object' &&
                    !Array.isArray(loggingConfig) && // Check if LogGroup property exists
                    ('LogGroup' in loggingConfig || 'logGroup' in loggingConfig)) {
                    return cdk_nag_1.NagRuleCompliance.COMPLIANT;
                }
                // If no loggingConfig or no LogGroup, it's non-compliant
                if (!loggingConfig) {
                    return cdk_nag_1.NagRuleCompliance.NON_COMPLIANT;
                }
                // Skip validation for complex objects that can't be resolved
                return cdk_nag_1.NagRuleCompliance.NOT_APPLICABLE;
            }
            return cdk_nag_1.NagRuleCompliance.NOT_APPLICABLE;
        };
        this.packName = 'Workshop';
    }
    visit(node) {
        if (node instanceof aws_cdk_lib_1.CfnResource) {
            this.applyRule({
                ruleSuffixOverride: 'CWL1',
                info: 'CloudWatch Log Groups should have retention policy configured',
                explanation: 'Log groups without retention policy will persist indefinitely, even after stack deletion. Set RetentionInDays property.',
                level: cdk_nag_1.NagMessageLevel.ERROR,
                rule: this.checkCloudWatchLogGroupRetention,
                node: node,
            });
            this.applyRule({
                ruleSuffixOverride: 'CWL2',
                info: 'CloudWatch Log Groups should have deletion policy set to Delete',
                explanation: 'Log groups without proper deletion policy may not be removed when stack is deleted.',
                level: cdk_nag_1.NagMessageLevel.ERROR,
                rule: this.checkCloudWatchLogGroupDeletion,
                node: node,
            });
            this.applyRule({
                ruleSuffixOverride: 'S3-1',
                info: 'S3 Buckets should have deletion policy configured',
                explanation: 'Buckets without proper deletion policy may not be removed when stack is deleted. Set removal policy to DELETE.',
                level: cdk_nag_1.NagMessageLevel.ERROR,
                rule: this.checkS3BucketDeletion,
                node: node,
            });
            this.applyRule({
                ruleSuffixOverride: 'S3-2',
                info: 'S3 Buckets should have auto-delete objects configured',
                explanation: 'Buckets with objects cannot be deleted unless auto-delete is enabled or objects are manually removed.',
                level: cdk_nag_1.NagMessageLevel.WARN,
                rule: this.checkS3BucketAutoDelete,
                node: node,
            });
            this.applyRule({
                ruleSuffixOverride: 'Lambda1',
                info: 'Lambda functions should have associated Log Groups',
                explanation: 'Lambda functions without pre-created log groups will create them with unlimited retention on first invocation.',
                level: cdk_nag_1.NagMessageLevel.ERROR,
                rule: this.checkLambdaLogGroupAssociation,
                node: node,
            });
        }
    }
    checkForAutoDeleteObjects(node) {
        const stack = aws_cdk_lib_1.Stack.of(node);
        const autoDeleteResources = stack.node
            .findAll()
            .filter((child) => child.node.id.includes('AutoDelete') && child.node.id.includes(node.node.id));
        return autoDeleteResources.length > 0;
    }
}
exports.WorkshopNagPack = WorkshopNagPack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya3Nob3AtbmFnLXBhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ3b3Jrc2hvcC1uYWctcGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FBaUQ7QUFFakQscUNBQTZHO0FBRTdHOzs7R0FHRztBQUNILE1BQWEsZUFBZ0IsU0FBUSxpQkFBTztJQUN4QyxZQUFZLFVBQXlCO1FBQ2pDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQztRQXlEZCxxQ0FBZ0MsR0FBRyxDQUFDLElBQWlCLEVBQWlCLEVBQUU7WUFDNUUsSUFBSSxJQUFJLENBQUMsZUFBZSxLQUFLLHFCQUFxQixFQUFFLENBQUM7Z0JBQ2pELE1BQU0saUJBQWlCLEdBQUcsa0JBQVEsQ0FBQyxrQkFBa0IsQ0FDakQsSUFBSSxFQUNILElBQW9ELENBQUMsZUFBZSxDQUN4RSxDQUFDO2dCQUNGLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO29CQUNyQixPQUFPLDJCQUFpQixDQUFDLGFBQWEsQ0FBQztnQkFDM0MsQ0FBQztnQkFDRCxPQUFPLDJCQUFpQixDQUFDLFNBQVMsQ0FBQztZQUN2QyxDQUFDO1lBQ0QsT0FBTywyQkFBaUIsQ0FBQyxjQUFjLENBQUM7UUFDNUMsQ0FBQyxDQUFDO1FBRU0sb0NBQStCLEdBQUcsQ0FBQyxJQUFpQixFQUFpQixFQUFFO1lBQzNFLElBQUksSUFBSSxDQUFDLGVBQWUsS0FBSyxxQkFBcUIsRUFBRSxDQUFDO2dCQUNqRCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLGNBQWMsQ0FBQztnQkFDdEQsSUFBSSxDQUFDLGNBQWMsSUFBSSxjQUFjLENBQUMsUUFBUSxFQUFFLEtBQUssUUFBUSxFQUFFLENBQUM7b0JBQzVELE9BQU8sMkJBQWlCLENBQUMsYUFBYSxDQUFDO2dCQUMzQyxDQUFDO2dCQUNELE9BQU8sMkJBQWlCLENBQUMsU0FBUyxDQUFDO1lBQ3ZDLENBQUM7WUFDRCxPQUFPLDJCQUFpQixDQUFDLGNBQWMsQ0FBQztRQUM1QyxDQUFDLENBQUM7UUFFTSwwQkFBcUIsR0FBRyxDQUFDLElBQWlCLEVBQWlCLEVBQUU7WUFDakUsSUFBSSxJQUFJLENBQUMsZUFBZSxLQUFLLGlCQUFpQixFQUFFLENBQUM7Z0JBQzdDLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsY0FBYyxDQUFDO2dCQUN0RCxJQUFJLENBQUMsY0FBYyxJQUFJLGNBQWMsQ0FBQyxRQUFRLEVBQUUsS0FBSyxRQUFRLEVBQUUsQ0FBQztvQkFDNUQsT0FBTywyQkFBaUIsQ0FBQyxhQUFhLENBQUM7Z0JBQzNDLENBQUM7Z0JBQ0QsT0FBTywyQkFBaUIsQ0FBQyxTQUFTLENBQUM7WUFDdkMsQ0FBQztZQUNELE9BQU8sMkJBQWlCLENBQUMsY0FBYyxDQUFDO1FBQzVDLENBQUMsQ0FBQztRQUVNLDRCQUF1QixHQUFHLENBQUMsSUFBaUIsRUFBaUIsRUFBRTtZQUNuRSxJQUFJLElBQUksQ0FBQyxlQUFlLEtBQUssaUJBQWlCLEVBQUUsQ0FBQztnQkFDN0MsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLHlCQUF5QixDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUMzRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7b0JBQ2pCLE9BQU8sMkJBQWlCLENBQUMsYUFBYSxDQUFDO2dCQUMzQyxDQUFDO2dCQUNELE9BQU8sMkJBQWlCLENBQUMsU0FBUyxDQUFDO1lBQ3ZDLENBQUM7WUFDRCxPQUFPLDJCQUFpQixDQUFDLGNBQWMsQ0FBQztRQUM1QyxDQUFDLENBQUM7UUFFTSxtQ0FBOEIsR0FBRyxDQUFDLElBQWlCLEVBQWlCLEVBQUU7WUFDMUUsSUFBSSxJQUFJLENBQUMsZUFBZSxLQUFLLHVCQUF1QixFQUFFLENBQUM7Z0JBQ25ELHlEQUF5RDtnQkFDekQsTUFBTSxrQkFBa0IsR0FBRztvQkFDdkIsVUFBVTtvQkFDVixjQUFjO29CQUNkLGlCQUFpQjtvQkFDakIseUJBQXlCO29CQUN6Qiw4Q0FBOEM7aUJBQ2pELENBQUM7Z0JBRUYsSUFBSSxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztvQkFDckUsT0FBTywyQkFBaUIsQ0FBQyxjQUFjLENBQUM7Z0JBQzVDLENBQUM7Z0JBRUQsTUFBTSxhQUFhLEdBQUksSUFBa0QsQ0FBQyxhQUFhLENBQUM7Z0JBRXhGLGlFQUFpRTtnQkFDakUsSUFDSSxhQUFhO29CQUNiLE9BQU8sYUFBYSxLQUFLLFFBQVE7b0JBQ2pDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsSUFBSSxvQ0FBb0M7b0JBQ3JFLENBQUMsVUFBVSxJQUFJLGFBQWEsSUFBSSxVQUFVLElBQUksYUFBYSxDQUFDLEVBQzlELENBQUM7b0JBQ0MsT0FBTywyQkFBaUIsQ0FBQyxTQUFTLENBQUM7Z0JBQ3ZDLENBQUM7Z0JBRUQseURBQXlEO2dCQUN6RCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7b0JBQ2pCLE9BQU8sMkJBQWlCLENBQUMsYUFBYSxDQUFDO2dCQUMzQyxDQUFDO2dCQUVELDZEQUE2RDtnQkFDN0QsT0FBTywyQkFBaUIsQ0FBQyxjQUFjLENBQUM7WUFDNUMsQ0FBQztZQUNELE9BQU8sMkJBQWlCLENBQUMsY0FBYyxDQUFDO1FBQzVDLENBQUMsQ0FBQztRQTNJRSxJQUFJLENBQUMsUUFBUSxHQUFHLFVBQVUsQ0FBQztJQUMvQixDQUFDO0lBRU0sS0FBSyxDQUFDLElBQWdCO1FBQ3pCLElBQUksSUFBSSxZQUFZLHlCQUFXLEVBQUUsQ0FBQztZQUM5QixJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNYLGtCQUFrQixFQUFFLE1BQU07Z0JBQzFCLElBQUksRUFBRSwrREFBK0Q7Z0JBQ3JFLFdBQVcsRUFDUCx5SEFBeUg7Z0JBQzdILEtBQUssRUFBRSx5QkFBZSxDQUFDLEtBQUs7Z0JBQzVCLElBQUksRUFBRSxJQUFJLENBQUMsZ0NBQWdDO2dCQUMzQyxJQUFJLEVBQUUsSUFBSTthQUNiLENBQUMsQ0FBQztZQUVILElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ1gsa0JBQWtCLEVBQUUsTUFBTTtnQkFDMUIsSUFBSSxFQUFFLGlFQUFpRTtnQkFDdkUsV0FBVyxFQUFFLHFGQUFxRjtnQkFDbEcsS0FBSyxFQUFFLHlCQUFlLENBQUMsS0FBSztnQkFDNUIsSUFBSSxFQUFFLElBQUksQ0FBQywrQkFBK0I7Z0JBQzFDLElBQUksRUFBRSxJQUFJO2FBQ2IsQ0FBQyxDQUFDO1lBRUgsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDWCxrQkFBa0IsRUFBRSxNQUFNO2dCQUMxQixJQUFJLEVBQUUsbURBQW1EO2dCQUN6RCxXQUFXLEVBQ1AsZ0hBQWdIO2dCQUNwSCxLQUFLLEVBQUUseUJBQWUsQ0FBQyxLQUFLO2dCQUM1QixJQUFJLEVBQUUsSUFBSSxDQUFDLHFCQUFxQjtnQkFDaEMsSUFBSSxFQUFFLElBQUk7YUFDYixDQUFDLENBQUM7WUFFSCxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNYLGtCQUFrQixFQUFFLE1BQU07Z0JBQzFCLElBQUksRUFBRSx1REFBdUQ7Z0JBQzdELFdBQVcsRUFDUCx1R0FBdUc7Z0JBQzNHLEtBQUssRUFBRSx5QkFBZSxDQUFDLElBQUk7Z0JBQzNCLElBQUksRUFBRSxJQUFJLENBQUMsdUJBQXVCO2dCQUNsQyxJQUFJLEVBQUUsSUFBSTthQUNiLENBQUMsQ0FBQztZQUVILElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ1gsa0JBQWtCLEVBQUUsU0FBUztnQkFDN0IsSUFBSSxFQUFFLG9EQUFvRDtnQkFDMUQsV0FBVyxFQUNQLGdIQUFnSDtnQkFDcEgsS0FBSyxFQUFFLHlCQUFlLENBQUMsS0FBSztnQkFDNUIsSUFBSSxFQUFFLElBQUksQ0FBQyw4QkFBOEI7Z0JBQ3pDLElBQUksRUFBRSxJQUFJO2FBQ2IsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztJQUNMLENBQUM7SUF1Rk8seUJBQXlCLENBQUMsSUFBaUI7UUFDL0MsTUFBTSxLQUFLLEdBQUcsbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDN0IsTUFBTSxtQkFBbUIsR0FBRyxLQUFLLENBQUMsSUFBSTthQUNqQyxPQUFPLEVBQUU7YUFDVCxNQUFNLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBRXJHLE9BQU8sbUJBQW1CLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQztJQUMxQyxDQUFDO0NBQ0o7QUF4SkQsMENBd0pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2ZuUmVzb3VyY2UsIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgSUNvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgTmFnUGFjaywgTmFnUGFja1Byb3BzLCBOYWdSdWxlQ29tcGxpYW5jZSwgTmFnUnVsZVJlc3VsdCwgTmFnTWVzc2FnZUxldmVsLCBOYWdSdWxlcyB9IGZyb20gJ2Nkay1uYWcnO1xuXG4vKipcbiAqIEN1c3RvbSBDREstbmFnIHJ1bGUgcGFjayBmb3Igd29ya3Nob3AgdmFsaWRhdGlvbi5cbiAqIEVuc3VyZXMgcmVzb3VyY2VzIGFyZSBjb25maWd1cmVkIGZvciBwcm9wZXIgZGVsZXRpb24gd2hlbiBzdGFjayBpcyBkZXN0cm95ZWQuXG4gKi9cbmV4cG9ydCBjbGFzcyBXb3Jrc2hvcE5hZ1BhY2sgZXh0ZW5kcyBOYWdQYWNrIHtcbiAgICBjb25zdHJ1Y3Rvcihwcm9wZXJ0aWVzPzogTmFnUGFja1Byb3BzKSB7XG4gICAgICAgIHN1cGVyKHByb3BlcnRpZXMpO1xuICAgICAgICB0aGlzLnBhY2tOYW1lID0gJ1dvcmtzaG9wJztcbiAgICB9XG5cbiAgICBwdWJsaWMgdmlzaXQobm9kZTogSUNvbnN0cnVjdCk6IHZvaWQge1xuICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIENmblJlc291cmNlKSB7XG4gICAgICAgICAgICB0aGlzLmFwcGx5UnVsZSh7XG4gICAgICAgICAgICAgICAgcnVsZVN1ZmZpeE92ZXJyaWRlOiAnQ1dMMScsXG4gICAgICAgICAgICAgICAgaW5mbzogJ0Nsb3VkV2F0Y2ggTG9nIEdyb3VwcyBzaG91bGQgaGF2ZSByZXRlbnRpb24gcG9saWN5IGNvbmZpZ3VyZWQnLFxuICAgICAgICAgICAgICAgIGV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgICAgICAgICAnTG9nIGdyb3VwcyB3aXRob3V0IHJldGVudGlvbiBwb2xpY3kgd2lsbCBwZXJzaXN0IGluZGVmaW5pdGVseSwgZXZlbiBhZnRlciBzdGFjayBkZWxldGlvbi4gU2V0IFJldGVudGlvbkluRGF5cyBwcm9wZXJ0eS4nLFxuICAgICAgICAgICAgICAgIGxldmVsOiBOYWdNZXNzYWdlTGV2ZWwuRVJST1IsXG4gICAgICAgICAgICAgICAgcnVsZTogdGhpcy5jaGVja0Nsb3VkV2F0Y2hMb2dHcm91cFJldGVudGlvbixcbiAgICAgICAgICAgICAgICBub2RlOiBub2RlLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuYXBwbHlSdWxlKHtcbiAgICAgICAgICAgICAgICBydWxlU3VmZml4T3ZlcnJpZGU6ICdDV0wyJyxcbiAgICAgICAgICAgICAgICBpbmZvOiAnQ2xvdWRXYXRjaCBMb2cgR3JvdXBzIHNob3VsZCBoYXZlIGRlbGV0aW9uIHBvbGljeSBzZXQgdG8gRGVsZXRlJyxcbiAgICAgICAgICAgICAgICBleHBsYW5hdGlvbjogJ0xvZyBncm91cHMgd2l0aG91dCBwcm9wZXIgZGVsZXRpb24gcG9saWN5IG1heSBub3QgYmUgcmVtb3ZlZCB3aGVuIHN0YWNrIGlzIGRlbGV0ZWQuJyxcbiAgICAgICAgICAgICAgICBsZXZlbDogTmFnTWVzc2FnZUxldmVsLkVSUk9SLFxuICAgICAgICAgICAgICAgIHJ1bGU6IHRoaXMuY2hlY2tDbG91ZFdhdGNoTG9nR3JvdXBEZWxldGlvbixcbiAgICAgICAgICAgICAgICBub2RlOiBub2RlLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuYXBwbHlSdWxlKHtcbiAgICAgICAgICAgICAgICBydWxlU3VmZml4T3ZlcnJpZGU6ICdTMy0xJyxcbiAgICAgICAgICAgICAgICBpbmZvOiAnUzMgQnVja2V0cyBzaG91bGQgaGF2ZSBkZWxldGlvbiBwb2xpY3kgY29uZmlndXJlZCcsXG4gICAgICAgICAgICAgICAgZXhwbGFuYXRpb246XG4gICAgICAgICAgICAgICAgICAgICdCdWNrZXRzIHdpdGhvdXQgcHJvcGVyIGRlbGV0aW9uIHBvbGljeSBtYXkgbm90IGJlIHJlbW92ZWQgd2hlbiBzdGFjayBpcyBkZWxldGVkLiBTZXQgcmVtb3ZhbCBwb2xpY3kgdG8gREVMRVRFLicsXG4gICAgICAgICAgICAgICAgbGV2ZWw6IE5hZ01lc3NhZ2VMZXZlbC5FUlJPUixcbiAgICAgICAgICAgICAgICBydWxlOiB0aGlzLmNoZWNrUzNCdWNrZXREZWxldGlvbixcbiAgICAgICAgICAgICAgICBub2RlOiBub2RlLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuYXBwbHlSdWxlKHtcbiAgICAgICAgICAgICAgICBydWxlU3VmZml4T3ZlcnJpZGU6ICdTMy0yJyxcbiAgICAgICAgICAgICAgICBpbmZvOiAnUzMgQnVja2V0cyBzaG91bGQgaGF2ZSBhdXRvLWRlbGV0ZSBvYmplY3RzIGNvbmZpZ3VyZWQnLFxuICAgICAgICAgICAgICAgIGV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgICAgICAgICAnQnVja2V0cyB3aXRoIG9iamVjdHMgY2Fubm90IGJlIGRlbGV0ZWQgdW5sZXNzIGF1dG8tZGVsZXRlIGlzIGVuYWJsZWQgb3Igb2JqZWN0cyBhcmUgbWFudWFsbHkgcmVtb3ZlZC4nLFxuICAgICAgICAgICAgICAgIGxldmVsOiBOYWdNZXNzYWdlTGV2ZWwuV0FSTixcbiAgICAgICAgICAgICAgICBydWxlOiB0aGlzLmNoZWNrUzNCdWNrZXRBdXRvRGVsZXRlLFxuICAgICAgICAgICAgICAgIG5vZGU6IG5vZGUsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdGhpcy5hcHBseVJ1bGUoe1xuICAgICAgICAgICAgICAgIHJ1bGVTdWZmaXhPdmVycmlkZTogJ0xhbWJkYTEnLFxuICAgICAgICAgICAgICAgIGluZm86ICdMYW1iZGEgZnVuY3Rpb25zIHNob3VsZCBoYXZlIGFzc29jaWF0ZWQgTG9nIEdyb3VwcycsXG4gICAgICAgICAgICAgICAgZXhwbGFuYXRpb246XG4gICAgICAgICAgICAgICAgICAgICdMYW1iZGEgZnVuY3Rpb25zIHdpdGhvdXQgcHJlLWNyZWF0ZWQgbG9nIGdyb3VwcyB3aWxsIGNyZWF0ZSB0aGVtIHdpdGggdW5saW1pdGVkIHJldGVudGlvbiBvbiBmaXJzdCBpbnZvY2F0aW9uLicsXG4gICAgICAgICAgICAgICAgbGV2ZWw6IE5hZ01lc3NhZ2VMZXZlbC5FUlJPUixcbiAgICAgICAgICAgICAgICBydWxlOiB0aGlzLmNoZWNrTGFtYmRhTG9nR3JvdXBBc3NvY2lhdGlvbixcbiAgICAgICAgICAgICAgICBub2RlOiBub2RlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGNoZWNrQ2xvdWRXYXRjaExvZ0dyb3VwUmV0ZW50aW9uID0gKG5vZGU6IENmblJlc291cmNlKTogTmFnUnVsZVJlc3VsdCA9PiB7XG4gICAgICAgIGlmIChub2RlLmNmblJlc291cmNlVHlwZSA9PT0gJ0FXUzo6TG9nczo6TG9nR3JvdXAnKSB7XG4gICAgICAgICAgICBjb25zdCByZXRlbnRpb25Qcm9wZXJ0eSA9IE5hZ1J1bGVzLnJlc29sdmVJZlByaW1pdGl2ZShcbiAgICAgICAgICAgICAgICBub2RlLFxuICAgICAgICAgICAgICAgIChub2RlIGFzIENmblJlc291cmNlICYgeyByZXRlbnRpb25JbkRheXM/OiB1bmtub3duIH0pLnJldGVudGlvbkluRGF5cyxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoIXJldGVudGlvblByb3BlcnR5KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIE5hZ1J1bGVDb21wbGlhbmNlLk5PTl9DT01QTElBTlQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gTmFnUnVsZUNvbXBsaWFuY2UuQ09NUExJQU5UO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBOYWdSdWxlQ29tcGxpYW5jZS5OT1RfQVBQTElDQUJMRTtcbiAgICB9O1xuXG4gICAgcHJpdmF0ZSBjaGVja0Nsb3VkV2F0Y2hMb2dHcm91cERlbGV0aW9uID0gKG5vZGU6IENmblJlc291cmNlKTogTmFnUnVsZVJlc3VsdCA9PiB7XG4gICAgICAgIGlmIChub2RlLmNmblJlc291cmNlVHlwZSA9PT0gJ0FXUzo6TG9nczo6TG9nR3JvdXAnKSB7XG4gICAgICAgICAgICBjb25zdCBkZWxldGlvblBvbGljeSA9IG5vZGUuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeTtcbiAgICAgICAgICAgIGlmICghZGVsZXRpb25Qb2xpY3kgfHwgZGVsZXRpb25Qb2xpY3kudG9TdHJpbmcoKSAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gTmFnUnVsZUNvbXBsaWFuY2UuTk9OX0NPTVBMSUFOVDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBOYWdSdWxlQ29tcGxpYW5jZS5DT01QTElBTlQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE5hZ1J1bGVDb21wbGlhbmNlLk5PVF9BUFBMSUNBQkxFO1xuICAgIH07XG5cbiAgICBwcml2YXRlIGNoZWNrUzNCdWNrZXREZWxldGlvbiA9IChub2RlOiBDZm5SZXNvdXJjZSk6IE5hZ1J1bGVSZXN1bHQgPT4ge1xuICAgICAgICBpZiAobm9kZS5jZm5SZXNvdXJjZVR5cGUgPT09ICdBV1M6OlMzOjpCdWNrZXQnKSB7XG4gICAgICAgICAgICBjb25zdCBkZWxldGlvblBvbGljeSA9IG5vZGUuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeTtcbiAgICAgICAgICAgIGlmICghZGVsZXRpb25Qb2xpY3kgfHwgZGVsZXRpb25Qb2xpY3kudG9TdHJpbmcoKSAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gTmFnUnVsZUNvbXBsaWFuY2UuTk9OX0NPTVBMSUFOVDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBOYWdSdWxlQ29tcGxpYW5jZS5DT01QTElBTlQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE5hZ1J1bGVDb21wbGlhbmNlLk5PVF9BUFBMSUNBQkxFO1xuICAgIH07XG5cbiAgICBwcml2YXRlIGNoZWNrUzNCdWNrZXRBdXRvRGVsZXRlID0gKG5vZGU6IENmblJlc291cmNlKTogTmFnUnVsZVJlc3VsdCA9PiB7XG4gICAgICAgIGlmIChub2RlLmNmblJlc291cmNlVHlwZSA9PT0gJ0FXUzo6UzM6OkJ1Y2tldCcpIHtcbiAgICAgICAgICAgIGNvbnN0IGhhc0F1dG9EZWxldGUgPSB0aGlzLmNoZWNrRm9yQXV0b0RlbGV0ZU9iamVjdHMobm9kZSk7XG4gICAgICAgICAgICBpZiAoIWhhc0F1dG9EZWxldGUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gTmFnUnVsZUNvbXBsaWFuY2UuTk9OX0NPTVBMSUFOVDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBOYWdSdWxlQ29tcGxpYW5jZS5DT01QTElBTlQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE5hZ1J1bGVDb21wbGlhbmNlLk5PVF9BUFBMSUNBQkxFO1xuICAgIH07XG5cbiAgICBwcml2YXRlIGNoZWNrTGFtYmRhTG9nR3JvdXBBc3NvY2lhdGlvbiA9IChub2RlOiBDZm5SZXNvdXJjZSk6IE5hZ1J1bGVSZXN1bHQgPT4ge1xuICAgICAgICBpZiAobm9kZS5jZm5SZXNvdXJjZVR5cGUgPT09ICdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAvLyBTa2lwIENESy1tYW5hZ2VkIExhbWJkYSBmdW5jdGlvbnMgdXNpbmcgcmVnZXggcGF0dGVybnNcbiAgICAgICAgICAgIGNvbnN0IGNka01hbmFnZWRQYXR0ZXJucyA9IFtcbiAgICAgICAgICAgICAgICAvQ3VzdG9tOjovLFxuICAgICAgICAgICAgICAgIC9Mb2dSZXRlbnRpb24vLFxuICAgICAgICAgICAgICAgIC9LdWJlY3RsUHJvdmlkZXIvLFxuICAgICAgICAgICAgICAgIC9DbHVzdGVyUmVzb3VyY2VQcm92aWRlci8sXG4gICAgICAgICAgICAgICAgL0FXU0NES0NmblV0aWxzUHJvdmlkZXJDdXN0b21SZXNvdXJjZVByb3ZpZGVyLyxcbiAgICAgICAgICAgIF07XG5cbiAgICAgICAgICAgIGlmIChjZGtNYW5hZ2VkUGF0dGVybnMuc29tZSgocGF0dGVybikgPT4gcGF0dGVybi50ZXN0KG5vZGUubG9naWNhbElkKSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gTmFnUnVsZUNvbXBsaWFuY2UuTk9UX0FQUExJQ0FCTEU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGxvZ2dpbmdDb25maWcgPSAobm9kZSBhcyBDZm5SZXNvdXJjZSAmIHsgbG9nZ2luZ0NvbmZpZz86IHVua25vd24gfSkubG9nZ2luZ0NvbmZpZztcblxuICAgICAgICAgICAgLy8gU2tpcCB2YWxpZGF0aW9uIGlmIGxvZ2dpbmdDb25maWcgY29udGFpbnMgbm9uLXByaW1pdGl2ZSB2YWx1ZXNcbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBsb2dnaW5nQ29uZmlnICYmXG4gICAgICAgICAgICAgICAgdHlwZW9mIGxvZ2dpbmdDb25maWcgPT09ICdvYmplY3QnICYmXG4gICAgICAgICAgICAgICAgIUFycmF5LmlzQXJyYXkobG9nZ2luZ0NvbmZpZykgJiYgLy8gQ2hlY2sgaWYgTG9nR3JvdXAgcHJvcGVydHkgZXhpc3RzXG4gICAgICAgICAgICAgICAgKCdMb2dHcm91cCcgaW4gbG9nZ2luZ0NvbmZpZyB8fCAnbG9nR3JvdXAnIGluIGxvZ2dpbmdDb25maWcpXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gTmFnUnVsZUNvbXBsaWFuY2UuQ09NUExJQU5UO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBJZiBubyBsb2dnaW5nQ29uZmlnIG9yIG5vIExvZ0dyb3VwLCBpdCdzIG5vbi1jb21wbGlhbnRcbiAgICAgICAgICAgIGlmICghbG9nZ2luZ0NvbmZpZykge1xuICAgICAgICAgICAgICAgIHJldHVybiBOYWdSdWxlQ29tcGxpYW5jZS5OT05fQ09NUExJQU5UO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBTa2lwIHZhbGlkYXRpb24gZm9yIGNvbXBsZXggb2JqZWN0cyB0aGF0IGNhbid0IGJlIHJlc29sdmVkXG4gICAgICAgICAgICByZXR1cm4gTmFnUnVsZUNvbXBsaWFuY2UuTk9UX0FQUExJQ0FCTEU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIE5hZ1J1bGVDb21wbGlhbmNlLk5PVF9BUFBMSUNBQkxFO1xuICAgIH07XG5cbiAgICBwcml2YXRlIGNoZWNrRm9yQXV0b0RlbGV0ZU9iamVjdHMobm9kZTogQ2ZuUmVzb3VyY2UpOiBib29sZWFuIHtcbiAgICAgICAgY29uc3Qgc3RhY2sgPSBTdGFjay5vZihub2RlKTtcbiAgICAgICAgY29uc3QgYXV0b0RlbGV0ZVJlc291cmNlcyA9IHN0YWNrLm5vZGVcbiAgICAgICAgICAgIC5maW5kQWxsKClcbiAgICAgICAgICAgIC5maWx0ZXIoKGNoaWxkKSA9PiBjaGlsZC5ub2RlLmlkLmluY2x1ZGVzKCdBdXRvRGVsZXRlJykgJiYgY2hpbGQubm9kZS5pZC5pbmNsdWRlcyhub2RlLm5vZGUuaWQpKTtcblxuICAgICAgICByZXR1cm4gYXV0b0RlbGV0ZVJlc291cmNlcy5sZW5ndGggPiAwO1xuICAgIH1cbn1cbiJdfQ==