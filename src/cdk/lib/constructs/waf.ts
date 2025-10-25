import { RemovalPolicy } from 'aws-cdk-lib';
import { CfnLoggingConfiguration, CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { NagSuppressions } from 'cdk-nag';

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

        NagSuppressions.addResourceSuppressions(logGroup, [
            {
                id: 'Workshop-CWL3',
                reason: 'WAF Log group name must be prefixed with aws-waf-logs',
            },
        ]);
        return webAcl;
    }

    private createWafv2Outputs() {
        new StringParameter(this, 'WAFv2RegionalAclArnParam', {
            parameterName: `${PARAMETER_STORE_PREFIX}/waf/regional-acl-arn`,
            stringValue: this.wafv2RegionalAcl.attrArn,
            description: 'Regional WAF ACL ARN',
        });
    }

    public static regionalAclArnFromParameter(): string {
        return `{{resolve:ssm:${PARAMETER_STORE_PREFIX}/waf/regional-acl-arn}}`;
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
        NagSuppressions.addResourceSuppressions(logGroup, [
            {
                id: 'Workshop-CWL3',
                reason: 'WAF Log group name must be prefixed with aws-waf-logs',
            },
        ]);
        return webAcl;
    }
    private createWafv2Outputs() {
        new StringParameter(this, 'WAFv2GlobalAclArnParam', {
            parameterName: `${PARAMETER_STORE_PREFIX}/waf/global-acl-arn`,
            stringValue: this.wafv2GlobalAcl.attrArn,
            description: 'Global WAF ACL ARN for CloudFront',
        });
    }

    public static globalAclArnFromParameter(): string {
        return `{{resolve:ssm:${PARAMETER_STORE_PREFIX}/waf/global-acl-arn}}`;
    }

    public replicateParameterToRegion(targetStack: Construct): void {
        new StringParameter(targetStack, 'GlobalWafArnReplicaParam', {
            parameterName: `${PARAMETER_STORE_PREFIX}/waf/global-acl-arn`,
            stringValue: this.wafv2GlobalAcl.attrArn,
            description: `Global WAF ACL ARN (replicated from us-east-1)`,
        });
    }
}
