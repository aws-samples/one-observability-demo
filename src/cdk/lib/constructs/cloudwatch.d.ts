/**
 * CloudWatch construct for the One Observability Workshop.
 *
 * This module provides CloudWatch settings configuration.
 *
 * @packageDocumentation
 */
import { Construct } from 'constructs';
import { CfnResourcePolicy } from 'aws-cdk-lib/aws-logs';
import { CfnTransactionSearchConfig } from 'aws-cdk-lib/aws-xray';
/**
 * Configuration properties for the CloudWatchTransactionSearch construct.
 */
export interface CloudWatchTransactionSearchProperties {
    /** Indexing percentage for transaction search (0-100) */
    indexingPercentage?: number;
}
/**
 * A CDK construct that creates CloudWatch Transaction Search configuration
 * with CloudWatch logs resource policy for the observability workshop.
 */
export declare class CloudWatchTransactionSearch extends Construct {
    /** The CloudWatch resource policy for X-Ray access */
    readonly resourcePolicy: CfnResourcePolicy;
    /** The X-Ray transaction search configuration */
    readonly transactionSearchConfig: CfnTransactionSearchConfig;
    /**
     * Creates a new CloudWatch TransactionSearch construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for CloudWatch Transaction Search
     */
    constructor(scope: Construct, id: string, properties?: CloudWatchTransactionSearchProperties);
}
