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
import { OpenSearchCollection, OpenSearchCollectionProperties } from '../constructs/opensearch-collection';
import { OpenSearchApplication, OpenSearchApplicationProperties } from '../constructs/opensearch-application';
import { CodeBuildStep } from 'aws-cdk-lib/pipelines';
import { ManagedPolicy, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { IBucket } from 'aws-cdk-lib/aws-s3';

export interface StorageProperties extends StackProps {
    assetsProperties?: AssetsProperties;
    dynamoDatabaseProperties?: DynamoDatabaseProperties;
    auroraDatabaseProperties?: AuroraDBProperties;
    opensearchCollectionProperties?: OpenSearchCollectionProperties;
    opensearchApplicationProperties?: Omit<OpenSearchApplicationProperties, 'collection'>;
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
    public getDDBSeedingStep(scope: Stack, artifactBucket: IBucket) {
        const seedingRole = new Role(scope, 'DDBSeedingRole', {
            assumedBy: new ServicePrincipal('codebuild.amazonaws.com'),
            description: 'CodeBuild role for DynamoDB seeding',
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess_v2')],
        });

        artifactBucket.grantRead(seedingRole);
        new Policy(scope, 'DDBSeedingPolicy', {
            roles: [seedingRole],
            statements: [
                new PolicyStatement({
                    actions: ['ssm:GetParameter'],
                    resources: ['*'],
                }),
            ],
        });

        // Seeding action role needs access to retrieve the table
        // name from Parameter store, and full access to dynamodb

        const seedStep = new CodeBuildStep('DDBSeeding', {
            commands: [
                'cd src/cdk',
                'TABLE_NAME=$(./scripts/get-parameter.sh dynamodbtablename)',
                './scripts/seed-dynamodb.sh $TABLE_NAME',
            ],
            buildEnvironment: {
                privileged: false,
            },
            role: seedingRole,
        });

        NagSuppressions.addResourceSuppressions(
            seedingRole,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'AWS Managed policies is acceptable for the DynamoDB Seeding action',
                },
            ],
            true,
        );

        return seedStep;
    }
}

export class StorageStack extends Stack {
    public readonly dynamoDatabase: DynamoDatabase;
    public readonly auroraDatabase: AuroraDatabase;
    public readonly workshopAssets: WorkshopAssets;
    constructor(scope: Construct, id: string, properties: StorageProperties) {
        super(scope, id, properties);

        const vpc = WorkshopNetwork.importVpcFromExports(this, 'vpc');

        /** Add Assets resources */
        this.workshopAssets = new WorkshopAssets(this, 'WorkshopAssets', properties.assetsProperties);

        /** Add DynamoDB resource */
        this.dynamoDatabase = new DynamoDatabase(this, 'DynamoDb', properties.dynamoDatabaseProperties);

        const databaseProperties = properties.auroraDatabaseProperties || {};
        if (databaseProperties) {
            databaseProperties.vpc = vpc;
        }
        /** Add Database resource */
        this.auroraDatabase = new AuroraDatabase(this, 'AuroraDatabase', databaseProperties);

        /** Add OpenSearch Collection resource */
        const openSearchCollection = new OpenSearchCollection(
            this,
            'OpenSearchCollection',
            properties.opensearchCollectionProperties,
        );

        /** Add OpenSearch Application resource */
        new OpenSearchApplication(this, 'OpenSearchUiApplication', {
            collection: openSearchCollection,
            ...properties.opensearchApplicationProperties,
        });

        Utilities.SuppressLogRetentionNagWarnings(this);
    }
}
