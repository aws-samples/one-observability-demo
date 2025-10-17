import { CfnOutput, Fn, Names, RemovalPolicy } from 'aws-cdk-lib';
import { CfnLoggingConfiguration, CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { WAFV2_GLOABL_ACL_ARN_EXPORT_NAME, WAFV2_REGIONAL_ACL_ARN_EXPORT_NAME } from '../../bin/constants';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

export interface WorkshopWebAclProperties {
    logRetention?: RetentionDays;
}

export class RegionalWaf extends Construct {
    /** WAFv2 Regional ACL */
    public readonly wafv2RegionalAcl: CfnWebACL;

    constructor(scope: Construct, id: string, properties: WorkshopWebAclProperties) {
        super(scope, id);

        this.wafv2RegionalAcl = this.enableRegionalWafv2(properties);
        this.createWafv2Outputs();
    }
    /**
     * Enables WAF for regional endpoints if enabled
     */
    private enableRegionalWafv2(properties: WorkshopWebAclProperties): CfnWebACL {
        const logGroup = new LogGroup(this, 'WAFv2RegionalLogGroup', {
            retention: properties.logRetention || RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
            logGroupName: 'aws-waf-logs-regional-' + Names.uniqueId(this),
        });

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
                        count: {},
                    },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'ManagedDefaultRules',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });

        new CfnLoggingConfiguration(this, 'WAFv2RegionalLogging', {
            logDestinationConfigs: [logGroup.logGroupArn],
            resourceArn: webAcl.attrArn,
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

    constructor(scope: Construct, id: string, properties: WorkshopWebAclProperties) {
        super(scope, id);

        this.wafv2GlobalAcl = this.enableGlobalWafv2(properties);
        this.createWafv2Outputs();
    }

    /**
     * Enables WAF for global endpoints if enabled
     */
    private enableGlobalWafv2(properties: WorkshopWebAclProperties): CfnWebACL {
        const logGroup = new LogGroup(this, 'WAFv2GlobalLogGroup', {
            retention: properties.logRetention || RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY,
            logGroupName: 'aws-waf-logs-global-' + Names.uniqueId(this),
        });
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
                        count: {},
                    },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: 'ManagedDefaultRules',
                        sampledRequestsEnabled: true,
                    },
                },
            ],
        });
        new CfnLoggingConfiguration(this, 'WAFv2GlobalLogging', {
            logDestinationConfigs: [logGroup.logGroupArn],
            resourceArn: webAcl.attrArn,
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
