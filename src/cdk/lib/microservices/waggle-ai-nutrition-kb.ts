/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Nutrition RAG Knowledge Base (Bedrock KB on S3 Vectors), provisioned and ingested in CDK.
 *
 * @packageDocumentation
 */
import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnKnowledgeBase, CfnDataSource } from 'aws-cdk-lib/aws-bedrock';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnIndex, CfnVectorBucket } from 'aws-cdk-lib/aws-s3vectors';
import { Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { Utilities } from '../utils/utilities';

const EMBED_MODEL_ID = 'amazon.titan-embed-text-v2:0';
const EMBED_DIM = 1024;

export interface WaggleAINutritionKbProperties {
    /** SSM parameter (short name under PARAMETER_STORE_PREFIX) to publish the KB id. */
    readonly ssmKbIdParameterName: string;
}

/** Nutrition RAG Knowledge Base on S3 Vectors. */
export class WaggleAINutritionKb extends Construct {
    public readonly knowledgeBaseId: string;

    constructor(scope: Construct, id: string, properties: WaggleAINutritionKbProperties) {
        super(scope, id);
        const { region, account } = Stack.of(this);
        const embedModelArn = `arn:aws:bedrock:${region}::foundation-model/${EMBED_MODEL_ID}`;
        const vectorBucketName = `waggle-ai-nutrition-vectors-${account}`;
        // Built from known values, not the L1 token: the policy must cover `.../index/*` at KB creation.
        const vectorBucketArn = `arn:aws:s3vectors:${region}:${account}:bucket/${vectorBucketName}`;

        // --- S3 Vectors: bucket + index (dim 1024, cosine, float32) ---
        const vectorBucket = new CfnVectorBucket(this, 'VectorBucket', { vectorBucketName });
        const index = new CfnIndex(this, 'VectorIndex', {
            vectorBucketName,
            indexName: 'nutrition-index',
            dataType: 'float32',
            dimension: EMBED_DIM,
            distanceMetric: 'cosine',
        });
        index.addDependency(vectorBucket);

        // --- Source docs bucket, seeded with the nutrition corpus ---
        const sourceBucket = new Bucket(this, 'KbSource', {
            enforceSSL: true,
            encryption: BucketEncryption.S3_MANAGED,
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
        });
        new BucketDeployment(this, 'KbDocs', {
            sources: [
                Source.asset(
                    // Built without `node:path` on purpose: `unicorn/import-style` requires a
                    // default import, which this package's tsconfig rejects (no `esModuleInterop`).
                    `${__dirname}/../../../applications/microservices/waggle_ai_agents/rag/knowledge`,
                ),
            ],
            destinationBucket: sourceBucket,
            destinationKeyPrefix: 'nutrition/',
        });

        // --- KB execution role ---
        const kbRole = new Role(this, 'KbRole', { assumedBy: new ServicePrincipal('bedrock.amazonaws.com') });
        kbRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['bedrock:InvokeModel'],
                resources: [embedModelArn],
            }),
        );
        kbRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['s3vectors:*'],
                resources: [vectorBucketArn, `${vectorBucketArn}/*`],
            }),
        );
        kbRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['s3:GetObject', 's3:ListBucket'],
                resources: [sourceBucket.bucketArn, `${sourceBucket.bucketArn}/*`],
            }),
        );

        // --- Knowledge Base (S3_VECTORS storage) ---
        const kb = new CfnKnowledgeBase(this, 'KnowledgeBase', {
            name: 'waggle-ai-nutrition-kb',
            description: 'Pet nutrition guidance for the nutrition agent',
            roleArn: kbRole.roleArn,
            knowledgeBaseConfiguration: {
                type: 'VECTOR',
                vectorKnowledgeBaseConfiguration: {
                    embeddingModelArn: embedModelArn,
                    embeddingModelConfiguration: {
                        bedrockEmbeddingModelConfiguration: { dimensions: EMBED_DIM, embeddingDataType: 'FLOAT32' },
                    },
                },
            },
            storageConfiguration: {
                type: 'S3_VECTORS',
                s3VectorsConfiguration: { indexArn: index.attrIndexArn },
            },
        });
        kb.addDependency(index);
        // Depend on the whole role, not just roleArn, or the KB races the DefaultPolicy attach and 403s.
        kb.node.addDependency(kbRole);
        this.knowledgeBaseId = kb.attrKnowledgeBaseId;

        // --- S3 data source ---
        const dataSource = new CfnDataSource(this, 'DataSource', {
            knowledgeBaseId: kb.attrKnowledgeBaseId,
            name: 'nutrition-docs',
            dataSourceConfiguration: {
                type: 'S3',
                s3Configuration: { bucketArn: sourceBucket.bucketArn, inclusionPrefixes: ['nutrition/'] },
            },
        });
        dataSource.addDependency(kb);

        // --- Initial ingestion (no CFN resource for StartIngestionJob -> custom resource) ---
        const ingestion = new AwsCustomResource(this, 'Ingestion', {
            onCreate: {
                service: 'bedrock-agent',
                action: 'startIngestionJob',
                parameters: {
                    knowledgeBaseId: kb.attrKnowledgeBaseId,
                    dataSourceId: dataSource.attrDataSourceId,
                },
                physicalResourceId: PhysicalResourceId.of(`${kb.attrKnowledgeBaseId}-ingest`),
            },
            policy: AwsCustomResourcePolicy.fromStatements([
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ['bedrock:StartIngestionJob'],
                    resources: [kb.attrKnowledgeBaseArn],
                }),
            ]),
        });
        ingestion.node.addDependency(dataSource);

        Utilities.createSsmParameters(
            this,
            PARAMETER_STORE_PREFIX,
            new Map([[properties.ssmKbIdParameterName, this.knowledgeBaseId]]),
        );
        new CfnOutput(this, 'NutritionKnowledgeBaseId', { value: this.knowledgeBaseId });

        NagSuppressions.addResourceSuppressions(
            kbRole,
            [{ id: 'AwsSolutions-IAM5', reason: 'KB accesses its own S3 Vectors index and source bucket' }],
            true,
        );
    }
}
