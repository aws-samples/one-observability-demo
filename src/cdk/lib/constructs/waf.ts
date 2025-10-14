import { CfnOutput, Fn } from 'aws-cdk-lib';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { WAFV2_GLOABL_ACL_ARN_EXPORT_NAME, WAFV2_REGIONAL_ACL_ARN_EXPORT_NAME } from '../../bin/constants';

export class RegionalWaf extends Construct {
    /** WAFv2 Regional ACL */
    public readonly wafv2RegionalAcl: CfnWebACL;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        this.wafv2RegionalAcl = this.enableRegionalWafv2();
        this.createWafv2Outputs();
    }
    /**
     * Enables WAF for regional endpoints if enabled
     */
    private enableRegionalWafv2(): CfnWebACL {
        const webAcl = new CfnWebACL(this, 'WAFv2RegionalACL', {
            defaultAction: {
                allow: {},
            },
            scope: 'REGIONAL',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'RegionalWafv2ACL',
                sampledRequestsEnabled: true,
            },
            description: 'WAF ACL for regional resources',
            name: 'RegionalACL',
            rules: [
                {
                    name: 'ManagedDefaultRules',
                    priority: 0,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesCommonRuleSet',
                            vendorName: 'AWS',
                        },
                    },
                    overrideAction: {
                        none: {},
                    },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'ManagedDefaultRules',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });
        return webAcl;
    }

    private createWafv2Outputs() {
        new CfnOutput(this, 'WAFv2RegionalAclArn', {
            value: this.wafv2RegionalAcl.attrArn,
            exportName: WAFV2_REGIONAL_ACL_ARN_EXPORT_NAME,
        });
    }

    public static regionalAclArnFromExports(): string {
        return Fn.importValue(WAFV2_REGIONAL_ACL_ARN_EXPORT_NAME);
    }
}

export class GlobalWaf extends Construct {
    /** WAFv2 Global ACL */
    public readonly wafv2GlobalAcl: CfnWebACL;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        this.wafv2GlobalAcl = this.enableGlobalWafv2();
        this.createWafv2Outputs();
    }

    /**
     * Enables WAF for global endpoints if enabled
     */
    private enableGlobalWafv2(): CfnWebACL {
        const webAcl = new CfnWebACL(this, 'WAFv2GlobalACL', {
            defaultAction: {
                allow: {},
            },
            scope: 'CLOUDFRONT',
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: 'GlobalWafv2ACL',
                sampledRequestsEnabled: true,
            },
            description: 'WAF ACL for global resources',
            name: 'GlobalACL',
            rules: [
                {
                    name: 'ManagedDefaultRules',
                    priority: 0,
                    statement: {
                        managedRuleGroupStatement: {
                            name: 'AWSManagedRulesCommonRuleSet',
                            vendorName: 'AWS',
                        },
                    },
                    overrideAction: {
                        none: {},
                    },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'ManagedDefaultRules',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });
        return webAcl;
    }
    private createWafv2Outputs() {
        new CfnOutput(this, 'WAFv2GloballAclArn', {
            value: this.wafv2GlobalAcl.attrArn,
            exportName: WAFV2_GLOABL_ACL_ARN_EXPORT_NAME,
        });
    }

    public static globalAclArnFromExports(): string {
        return Fn.importValue(WAFV2_GLOABL_ACL_ARN_EXPORT_NAME);
    }
}
