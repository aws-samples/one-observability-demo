/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { RemovalPolicy } from 'aws-cdk-lib';
import { TreatMissingData, ComparisonOperator } from 'aws-cdk-lib/aws-cloudwatch';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/**
 * Properties for configuring DynamoDatabase construct
 * @interface DynamoDbProperties
 */
export interface DynamoDatabaseProperties {
    /**
     * Threshold value for CloudWatch alarms on throttle events
     * @default 0
     */
    alarmThreshold?: number;
    /**
     * Number of evaluation periods for CloudWatch alarms
     * @default 1
     */
    evaluationPeriods?: number;
}

/**
 * AWS CDK Construct that creates DynamoDatabase table with CloudWatch alarms for pet adoption
 * @class DynamoDb
 * @extends Construct
 */
export class DynamoDatabase extends Construct {
    /**
     * The DynamoDatabase table for storing pet adoption data
     * @public
     */
    public table: Table;

    /**
     * Creates a new DynamoDatabase construct with table and monitoring alarms
     * Creates read and write throttle event alarms with configurable thresholds
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (required)
     */
    constructor(scope: Construct, id: string, properties?: DynamoDatabaseProperties) {
        super(scope, id);

        this.table = new Table(this, 'ddbPetadoption', {
            partitionKey: {
                name: 'pettype',
                type: AttributeType.STRING,
            },
            sortKey: {
                name: 'petid',
                type: AttributeType.STRING,
            },
            removalPolicy: RemovalPolicy.DESTROY,
        });

        this.table
            .metric('WriteThrottleEvents', { statistic: 'avg' })
            .createAlarm(this, 'WriteThrottleEvents-BasicAlarm', {
                threshold: properties?.alarmThreshold || 0,
                treatMissingData: TreatMissingData.NOT_BREACHING,
                comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: properties?.evaluationPeriods || 1,
                alarmName: `${this.table.tableName}-WriteThrottleEvents-BasicAlarm`,
            });

        this.table
            .metric('ReadThrottleEvents', { statistic: 'avg' })
            .createAlarm(this, 'ReadThrottleEvents-BasicAlarm', {
                threshold: properties?.alarmThreshold || 0,
                treatMissingData: TreatMissingData.NOT_BREACHING,
                comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: properties?.evaluationPeriods || 1,
                alarmName: `${this.table.tableName}-ReadThrottleEvents-BasicAlarm`,
            });

        NagSuppressions.addResourceSuppressions(
            this.table,
            [
                {
                    id: 'AwsSolutions-DDB3',
                    reason: 'Point-in-time Recovery not required for this table',
                },
            ],
            true,
        );
    }
}
