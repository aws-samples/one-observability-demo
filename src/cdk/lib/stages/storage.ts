/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AssetsProperties, WorkshopAssets } from '../constructs/assets';
import { DynamoDatabase as DynamoDatabase, DynamoDatabaseProperties } from '../constructs/dynamodb';
import { Utilities } from '../utils/utilities';
import { AuroraDatabase, AuroraDBProperties } from '../constructs/database';
import { WorkshopNetwork } from '../constructs/network';

export interface StorageProperties extends StackProps {
    assetsProperties?: AssetsProperties;
    dynamoDatabaseProperties?: DynamoDatabaseProperties;
    auroraDatabaseProperties?: AuroraDBProperties;
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
}

export class StorageStage extends Stage {
    public stack: StorageStack;
    constructor(scope: Construct, id: string, properties: StorageProperties) {
        super(scope, id, properties);
        this.stack = new StorageStack(this, 'StorageStack', properties);

        if (properties.tags) {
            Utilities.TagConstruct(this.stack, properties.tags);
        }
    }
}

export class StorageStack extends Stack {
    constructor(scope: Construct, id: string, properties: StorageProperties) {
        super(scope, id, properties);

        const vpc = WorkshopNetwork.importVpcFromExports(this, 'vpc');

        /** Add Assets resources */
        new WorkshopAssets(this, 'WorkshopAssets', properties.assetsProperties);

        /** Add DynamoDB resource */
        new DynamoDatabase(this, 'DynamoDb', properties.dynamoDatabaseProperties);

        const databaseProperties = properties.auroraDatabaseProperties || {};
        if (databaseProperties) {
            databaseProperties.vpc = vpc;
        }
        /** Add Database resource */
        new AuroraDatabase(this, 'AuroraDatabase', databaseProperties);

        Utilities.SuppressLogRetentionNagWarnings(this);
    }
}
