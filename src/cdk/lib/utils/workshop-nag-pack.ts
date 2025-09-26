import { CfnResource, Stack } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { NagPack, NagPackProps, NagRuleCompliance, NagRuleResult, NagMessageLevel, NagRules } from 'cdk-nag';

/**
 * Custom CDK-nag rule pack for workshop validation.
 * Ensures resources are configured for proper deletion when stack is destroyed.
 */
export class WorkshopNagPack extends NagPack {
    constructor(properties?: NagPackProps) {
        super(properties);
        this.packName = 'Workshop';
    }

    public visit(node: IConstruct): void {
        if (node instanceof CfnResource) {
            this.applyRule({
                ruleSuffixOverride: 'CWL1',
                info: 'CloudWatch Log Groups should have retention policy configured',
                explanation:
                    'Log groups without retention policy will persist indefinitely, even after stack deletion. Set RetentionInDays property.',
                level: NagMessageLevel.ERROR,
                rule: this.checkCloudWatchLogGroupRetention,
                node: node,
            });

            this.applyRule({
                ruleSuffixOverride: 'CWL2',
                info: 'CloudWatch Log Groups should have deletion policy set to Delete',
                explanation: 'Log groups without proper deletion policy may not be removed when stack is deleted.',
                level: NagMessageLevel.ERROR,
                rule: this.checkCloudWatchLogGroupDeletion,
                node: node,
            });

            this.applyRule({
                ruleSuffixOverride: 'S3-1',
                info: 'S3 Buckets should have deletion policy configured',
                explanation:
                    'Buckets without proper deletion policy may not be removed when stack is deleted. Set removal policy to DELETE.',
                level: NagMessageLevel.ERROR,
                rule: this.checkS3BucketDeletion,
                node: node,
            });

            this.applyRule({
                ruleSuffixOverride: 'S3-2',
                info: 'S3 Buckets should have auto-delete objects configured',
                explanation:
                    'Buckets with objects cannot be deleted unless auto-delete is enabled or objects are manually removed.',
                level: NagMessageLevel.WARN,
                rule: this.checkS3BucketAutoDelete,
                node: node,
            });

            this.applyRule({
                ruleSuffixOverride: 'Lambda1',
                info: 'Lambda functions should have associated Log Groups',
                explanation:
                    'Lambda functions without pre-created log groups will create them with unlimited retention on first invocation.',
                level: NagMessageLevel.ERROR,
                rule: this.checkLambdaLogGroupAssociation,
                node: node,
            });
        }
    }

    private checkCloudWatchLogGroupRetention = (node: CfnResource): NagRuleResult => {
        if (node.cfnResourceType === 'AWS::Logs::LogGroup') {
            const retentionProperty = NagRules.resolveIfPrimitive(
                node,
                (node as CfnResource & { retentionInDays?: unknown }).retentionInDays,
            );
            if (!retentionProperty) {
                return NagRuleCompliance.NON_COMPLIANT;
            }
            return NagRuleCompliance.COMPLIANT;
        }
        return NagRuleCompliance.NOT_APPLICABLE;
    };

    private checkCloudWatchLogGroupDeletion = (node: CfnResource): NagRuleResult => {
        if (node.cfnResourceType === 'AWS::Logs::LogGroup') {
            const deletionPolicy = node.cfnOptions.deletionPolicy;
            if (!deletionPolicy || deletionPolicy.toString() !== 'Delete') {
                return NagRuleCompliance.NON_COMPLIANT;
            }
            return NagRuleCompliance.COMPLIANT;
        }
        return NagRuleCompliance.NOT_APPLICABLE;
    };

    private checkS3BucketDeletion = (node: CfnResource): NagRuleResult => {
        if (node.cfnResourceType === 'AWS::S3::Bucket') {
            const deletionPolicy = node.cfnOptions.deletionPolicy;
            if (!deletionPolicy || deletionPolicy.toString() !== 'Delete') {
                return NagRuleCompliance.NON_COMPLIANT;
            }
            return NagRuleCompliance.COMPLIANT;
        }
        return NagRuleCompliance.NOT_APPLICABLE;
    };

    private checkS3BucketAutoDelete = (node: CfnResource): NagRuleResult => {
        if (node.cfnResourceType === 'AWS::S3::Bucket') {
            const hasAutoDelete = this.checkForAutoDeleteObjects(node);
            if (!hasAutoDelete) {
                return NagRuleCompliance.NON_COMPLIANT;
            }
            return NagRuleCompliance.COMPLIANT;
        }
        return NagRuleCompliance.NOT_APPLICABLE;
    };

    private checkLambdaLogGroupAssociation = (node: CfnResource): NagRuleResult => {
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
                return NagRuleCompliance.NOT_APPLICABLE;
            }

            const loggingConfig = (node as CfnResource & { loggingConfig?: unknown }).loggingConfig;

            // Skip validation if loggingConfig contains non-primitive values
            if (
                loggingConfig &&
                typeof loggingConfig === 'object' &&
                !Array.isArray(loggingConfig) && // Check if LogGroup property exists
                ('LogGroup' in loggingConfig || 'logGroup' in loggingConfig)
            ) {
                return NagRuleCompliance.COMPLIANT;
            }

            // If no loggingConfig or no LogGroup, it's non-compliant
            if (!loggingConfig) {
                return NagRuleCompliance.NON_COMPLIANT;
            }

            // Skip validation for complex objects that can't be resolved
            return NagRuleCompliance.NOT_APPLICABLE;
        }
        return NagRuleCompliance.NOT_APPLICABLE;
    };

    private checkForAutoDeleteObjects(node: CfnResource): boolean {
        const stack = Stack.of(node);
        const autoDeleteResources = stack.node
            .findAll()
            .filter((child) => child.node.id.includes('AutoDelete') && child.node.id.includes(node.node.id));

        return autoDeleteResources.length > 0;
    }
}
