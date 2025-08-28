/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * CloudWatch construct for the One Observability Workshop.
 *
 * This module provides CloudWatch settings configuration.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
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
export class CloudWatchTransactionSearch extends Construct {
    /** The CloudWatch resource policy for X-Ray access */
    public readonly resourcePolicy: CfnResourcePolicy;
    /** The X-Ray transaction search configuration */
    public readonly transactionSearchConfig: CfnTransactionSearchConfig;

    /**
     * Creates a new CloudWatch TransactionSearch construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for CloudWatch Transaction Search
     */
    constructor(scope: Construct, id: string, properties?: CloudWatchTransactionSearchProperties) {
        super(scope, id);

        const stack = Stack.of(this);

        // CloudWatch Transaction Search setup
        this.resourcePolicy = new CfnResourcePolicy(this, 'TransactionSearchLogResourcePolicy', {
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

        this.transactionSearchConfig = new CfnTransactionSearchConfig(this, 'TransactionSearchConfig', {
            indexingPercentage: properties?.indexingPercentage || 1,
        });

        this.transactionSearchConfig.addDependency(this.resourcePolicy);
    }
}