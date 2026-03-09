/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * DynamoDB table construct for the One Observability Workshop.
 *
 * Creates a DynamoDB table for the pet adoption catalog with:
 *
 * - **CloudWatch contributor insights** enabled for identifying hot keys and throttling patterns
 * - **CloudWatch alarms** for read/write throttle events
 * - **SSM Parameter Store** integration for service discovery of table name/ARN
 * - **On-demand capacity** mode for unpredictable workshop traffic patterns
 *
 * The table is used by the petsearch-java service for pet catalog lookups
 * and by the petstatusupdater Lambda for adoption status changes.
 *
 * > **Demo consideration**: Contributor Insights is enabled to demonstrate how DynamoDB
 * > surfaces access patterns. The throttle alarms showcase CloudWatch alarm integration.
 *
 * @packageDocumentation
 */
import { CfnOutput, Fn, RemovalPolicy } from 'aws-cdk-lib';
import { TreatMissingData, ComparisonOperator } from 'aws-cdk-lib/aws-cloudwatch';
import { AttributeType, ITable, Table } from 'aws-cdk-lib/aws-dynamodb';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import {
    DYNAMODB_TABLE_ARN_EXPORT_NAME,
    DYNAMODB_TABLE_NAME_EXPORT_NAME,
    SSM_PARAMETER_NAMES,
} from '../../bin/constants';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';

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
    public petAdoptionTable: Table;
    public petFoodsTable: Table;
    public petFoodsCartTable: Table;

    /**
     * Creates a new DynamoDatabase construct with table and monitoring alarms
     * Creates read and write throttle event alarms with configurable thresholds
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (required)
     */
    constructor(scope: Construct, id: string, properties?: DynamoDatabaseProperties) {
        super(scope, id);

        this.petAdoptionTable = new Table(this, 'ddbPetadoption', {
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

        this.petAdoptionTable
            .metric('WriteThrottleEvents', { statistic: 'avg' })
            .createAlarm(this, 'WriteThrottleEvents-BasicAlarm', {
                threshold: properties?.alarmThreshold || 0,
                treatMissingData: TreatMissingData.NOT_BREACHING,
                comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: properties?.evaluationPeriods || 1,
                alarmName: `${this.petAdoptionTable.tableName}-WriteThrottleEvents-BasicAlarm`,
            });

        this.petAdoptionTable
            .metric('ReadThrottleEvents', { statistic: 'avg' })
            .createAlarm(this, 'ReadThrottleEvents-BasicAlarm', {
                threshold: properties?.alarmThreshold || 0,
                treatMissingData: TreatMissingData.NOT_BREACHING,
                comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: properties?.evaluationPeriods || 1,
                alarmName: `${this.petAdoptionTable.tableName}-ReadThrottleEvents-BasicAlarm`,
            });

        this.petFoodsTable = new Table(this, 'ddbPetFoods', {
            partitionKey: {
                name: 'id',
                type: AttributeType.STRING,
            },
            removalPolicy: RemovalPolicy.DESTROY,
        });

        this.petFoodsTable.addGlobalSecondaryIndex({
            indexName: 'PetTypeIndex',
            partitionKey: {
                name: 'pet_type',
                type: AttributeType.STRING,
            },
            sortKey: {
                name: 'name',
                type: AttributeType.STRING,
            },
        });

        this.petFoodsTable.addGlobalSecondaryIndex({
            indexName: 'FoodTypeIndex',
            partitionKey: {
                name: 'food_type',
                type: AttributeType.STRING,
            },
            sortKey: {
                name: 'price',
                type: AttributeType.NUMBER,
            },
        });

        this.petFoodsCartTable = new Table(this, 'ddbPetFoodsCart', {
            partitionKey: {
                name: 'user_id',
                type: AttributeType.STRING,
            },
            removalPolicy: RemovalPolicy.DESTROY,
        });

        NagSuppressions.addResourceSuppressions(
            [this.petAdoptionTable, this.petFoodsCartTable, this.petFoodsTable],
            [
                {
                    id: 'AwsSolutions-DDB3',
                    reason: 'Point-in-time Recovery not required for this table',
                },
            ],
            true,
        );

        this.createExports();
        this.createOutputs();
    }

    private createExports(): void {
        new CfnOutput(this, 'TableArn', {
            value: this.petAdoptionTable.tableArn,
            exportName: DYNAMODB_TABLE_ARN_EXPORT_NAME,
            description: 'ARN of the DynamoDB table for pet adoption data',
        });

        new CfnOutput(this, 'TableName', {
            value: this.petAdoptionTable.tableName,
            exportName: DYNAMODB_TABLE_NAME_EXPORT_NAME,
            description: 'Name of the DynamoDB table for pet adoption data',
        });

        new CfnOutput(this, 'PetFoodsTableArn', {
            value: this.petFoodsTable.tableArn,
            exportName: `${DYNAMODB_TABLE_ARN_EXPORT_NAME}-PetFoods`,
            description: 'ARN of the DynamoDB table for pet food products',
        });

        new CfnOutput(this, 'PetFoodsTableName', {
            value: this.petFoodsTable.tableName,
            exportName: `${DYNAMODB_TABLE_NAME_EXPORT_NAME}-PetFoods`,
            description: 'Name of the DynamoDB table for pet food products',
        });

        new CfnOutput(this, 'PetFoodsCartTableArn', {
            value: this.petFoodsCartTable.tableArn,
            exportName: `${DYNAMODB_TABLE_ARN_EXPORT_NAME}-PetFoodsCart`,
            description: 'ARN of the DynamoDB table for pet food shopping cart',
        });

        new CfnOutput(this, 'PetFoodsCartTableName', {
            value: this.petFoodsCartTable.tableName,
            exportName: `${DYNAMODB_TABLE_NAME_EXPORT_NAME}-PetFoodsCart`,
            description: 'Name of the DynamoDB table for pet food shopping cart',
        });
    }

    public static importFromExports(
        scope: Construct,
        id: string,
    ): { table: ITable; petFoodsTable: ITable; petFoodsCartTable: ITable } {
        const tableArn = Fn.importValue(DYNAMODB_TABLE_ARN_EXPORT_NAME);
        const petFoodsTableArn = Fn.importValue(`${DYNAMODB_TABLE_ARN_EXPORT_NAME}-PetFoods`);
        const petFoodsCartTableArn = Fn.importValue(`${DYNAMODB_TABLE_ARN_EXPORT_NAME}-PetFoodsCart`);

        const petAdoptionsTable = Table.fromTableAttributes(scope, `${id}-Table`, {
            tableArn: tableArn,
        });

        const petFoodsTable = Table.fromTableAttributes(scope, `${id}-PetFoodsTable`, {
            tableArn: petFoodsTableArn,
            grantIndexPermissions: true,
        });

        const petFoodsCartTable = Table.fromTableAttributes(scope, `${id}-PetFoodsCartTable`, {
            tableArn: petFoodsCartTableArn,
        });

        return { table: petAdoptionsTable, petFoodsTable, petFoodsCartTable };
    }

    createOutputs(): void {
        if (this.petAdoptionTable && this.petFoodsTable && this.petFoodsCartTable) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.PET_ADOPTION_TABLE_NAME]: this.petAdoptionTable.tableName,
                        [SSM_PARAMETER_NAMES.PET_FOODS_TABLE_NAME]: this.petFoodsTable.tableName,
                        [SSM_PARAMETER_NAMES.PET_FOODS_CART_TABLE_NAME]: this.petFoodsCartTable.tableName,
                    }),
                ),
            );
        } else {
            throw new Error('Tables are not available');
        }
    }
}
