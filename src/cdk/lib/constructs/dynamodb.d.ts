import { ITable, Table } from 'aws-cdk-lib/aws-dynamodb';
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
export declare class DynamoDatabase extends Construct {
    /**
     * The DynamoDatabase table for storing pet adoption data
     * @public
     */
    petAdoptionTable: Table;
    petFoodsTable: Table;
    petFoodsCartTable: Table;
    /**
     * Creates a new DynamoDatabase construct with table and monitoring alarms
     * Creates read and write throttle event alarms with configurable thresholds
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (required)
     */
    constructor(scope: Construct, id: string, properties?: DynamoDatabaseProperties);
    private createExports;
    static importFromExports(scope: Construct, id: string): {
        table: ITable;
        petFoodsTable: ITable;
        petFoodsCartTable: ITable;
    };
    createOutputs(): void;
}
