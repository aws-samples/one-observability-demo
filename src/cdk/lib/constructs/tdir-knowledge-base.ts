/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Amazon Bedrock Knowledge Base construct for the TDIR workshop track.
 *
 * This module provisions a Bedrock Knowledge Base backed by an S3 data source and an
 * S3 Vectors index, controlled by the `CUSTOM_ENABLE_KNOWLEDGE_BASE` flag.
 *
 * In the TDIR workshop scenario, this knowledge base is the target of a "knowledge base
 * corruption" attack: `scripts/tdir-seed-scenarios.py` uploads adversarial documents
 * alongside the legitimate corpus and re-runs ingestion, so participants can observe
 * poisoned content being retrieved and trace it back through object metadata.
 *
 * > **Isolation note**: this is the workshop's *own* knowledge base. It deliberately does
 * > not touch the shared `waggle-ai-nutrition-kb` that the Waggle AI agents retrieve from,
 * > because poisoning that one would degrade every other workshop built on this scaffolding.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { stableOutput } from '../utils/stable-output';
import { Bucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Role, ServicePrincipal, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { CfnKnowledgeBase, CfnDataSource } from 'aws-cdk-lib/aws-bedrock';
import { CfnIndex, CfnVectorBucket } from 'aws-cdk-lib/aws-s3vectors';
import { NagSuppressions } from 'cdk-nag';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { Utilities } from '../utils/utilities';

/** Dimensions and data type must match the embedding model below. */
const EMBED_DIM = 1024;

/**
 * Configuration properties for the TdirKnowledgeBase construct.
 */
export interface TdirKnowledgeBaseProperties {
    /** Embedding model ID for vectorizing documents */
    embeddingModelId?: string;
}

/**
 * A CDK construct that creates a Bedrock Knowledge Base with an S3 data source and an
 * S3 Vectors index for the TDIR workshop's corruption scenario.
 *
 * The knowledge base uses:
 * - an S3 bucket for source documents (versioned, so corruption is auditable)
 * - an S3 Vectors bucket and index as the vector store
 * - a Bedrock embedding model for vectorization
 * - a one-shot ingestion job so seeded documents are actually embedded
 *
 * Workshop participants investigate this knowledge base for signs of
 * data corruption (adversarial document injection).
 */
export class TdirKnowledgeBase extends Construct {
    /** The S3 bucket containing knowledge base documents */
    public readonly dataBucket: Bucket;
    /** The Bedrock Knowledge Base */
    public readonly knowledgeBase: CfnKnowledgeBase;
    /** The data source connecting S3 to the knowledge base */
    public readonly dataSource: CfnDataSource;
    /** The knowledge base id, published to SSM for the seeding script */
    public readonly knowledgeBaseId: string;

    /**
     * Creates a new TdirKnowledgeBase construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the knowledge base
     */
    constructor(scope: Construct, id: string, properties?: TdirKnowledgeBaseProperties) {
        super(scope, id);

        const props = properties || {};
        const embeddingModelId = props.embeddingModelId || 'amazon.titan-embed-text-v2:0';
        const region = Stack.of(this).region;
        const account = Stack.of(this).account;
        const embedModelArn = `arn:aws:bedrock:${region}::foundation-model/${embeddingModelId}`;

        // S3 bucket for knowledge base documents.
        // Seeded at runtime by scripts/tdir-seed-scenarios.py, not by a BucketDeployment:
        // BucketDeployment defaults to prune=true and would delete the planted documents
        // on any redeploy, silently resetting the scenario mid-workshop.
        this.dataBucket = new Bucket(this, 'DataBucket', {
            encryption: BucketEncryption.S3_MANAGED,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: true, // Versioning helps detect corruption
        });

        // --- S3 Vectors: bucket + index backing the knowledge base ---
        // Physical name must be known up front so the IAM policy below can cover `.../index/*`
        // at knowledge base creation time.
        const vectorBucketName = `tdir-workshop-vectors-${account}`;
        const vectorBucketArn = `arn:aws:s3vectors:${region}:${account}:bucket/${vectorBucketName}`;

        const vectorBucket = new CfnVectorBucket(this, 'VectorBucket', { vectorBucketName });
        const vectorIndex = new CfnIndex(this, 'VectorIndex', {
            vectorBucketName,
            indexName: 'petfood-product-index',
            dataType: 'float32',
            dimension: EMBED_DIM,
            distanceMetric: 'cosine',
        });
        vectorIndex.addDependency(vectorBucket);

        // IAM role for Bedrock to access the knowledge base resources
        const kbRole = new Role(this, 'KnowledgeBaseRole', {
            assumedBy: new ServicePrincipal('bedrock.amazonaws.com', {
                conditions: {
                    StringEquals: {
                        'aws:SourceAccount': account,
                    },
                    ArnLike: {
                        'aws:SourceArn': `arn:aws:bedrock:${region}:${account}:knowledge-base/*`,
                    },
                },
            }),
        });

        kbRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['bedrock:InvokeModel'],
                resources: [embedModelArn],
            }),
        );

        kbRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['s3vectors:*'],
                resources: [vectorBucketArn, `${vectorBucketArn}/*`],
            }),
        );

        kbRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['s3:GetObject', 's3:ListBucket'],
                resources: [this.dataBucket.bucketArn, `${this.dataBucket.bucketArn}/*`],
            }),
        );

        // Knowledge Base backed by the S3 Vectors index.
        this.knowledgeBase = new CfnKnowledgeBase(this, 'KnowledgeBase', {
            name: 'petfood-product-knowledge',
            description: 'Pet food product information for the AI recommendation agent',
            roleArn: kbRole.roleArn,
            knowledgeBaseConfiguration: {
                type: 'VECTOR',
                vectorKnowledgeBaseConfiguration: {
                    embeddingModelArn: embedModelArn,
                    embeddingModelConfiguration: {
                        bedrockEmbeddingModelConfiguration: {
                            dimensions: EMBED_DIM,
                            embeddingDataType: 'FLOAT32',
                        },
                    },
                },
            },
            storageConfiguration: {
                type: 'S3_VECTORS',
                s3VectorsConfiguration: { indexArn: vectorIndex.attrIndexArn },
            },
        });
        this.knowledgeBase.addDependency(vectorIndex);
        // Depend on the whole role, not just roleArn, or the knowledge base races the
        // DefaultPolicy attachment and fails with a 403.
        this.knowledgeBase.node.addDependency(kbRole);
        this.knowledgeBaseId = this.knowledgeBase.attrKnowledgeBaseId;

        // Data source connecting S3 bucket to the knowledge base.
        // No inclusionPrefixes: the whole bucket is in scope, so the seeding script can
        // choose its own key prefixes without the two definitions drifting apart.
        this.dataSource = new CfnDataSource(this, 'S3DataSource', {
            knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
            name: 'petfood-documents',
            description: 'Pet food product catalog and nutritional information',
            dataSourceConfiguration: {
                type: 'S3',
                s3Configuration: {
                    bucketArn: this.dataBucket.bucketArn,
                },
            },
        });
        this.dataSource.addDependency(this.knowledgeBase);

        // Deliberately no create-time ingestion job: the source bucket is empty at deploy
        // time (documents are uploaded later by scripts/tdir-seed-scenarios.py), so a job
        // here would index nothing. The seeding script starts ingestion after uploading,
        // which is also the only point at which the corpus is complete.

        // Published so scripts/tdir-seed-scenarios.py can find the knowledge base and its
        // source bucket without guessing CloudFormation stack or logical resource names.
        // The data source id is published too: recovering a poisoned knowledge base means
        // running an ingestion job to evict the embedded content, and StartIngestionJob
        // requires --data-source-id. Without this the workshop's recovery step has to tell
        // participants to look it up, and the value is service-generated so it cannot be
        // written into the guide.
        Utilities.createSsmParameters(
            this,
            PARAMETER_STORE_PREFIX,
            new Map([
                ['tdir/knowledgebaseid', this.knowledgeBaseId],
                ['tdir/knowledgebasebucket', this.dataBucket.bucketName],
                ['tdir/knowledgebasedatasourceid', this.dataSource.attrDataSourceId],
            ]),
        );

        // Logical ids are pinned so the workshop guide and runbooks can reference an output by
        // a stable name. Without overrideLogicalId, CDK appends a hash of the construct path
        // (e.g. KnowledgeBaseTdirKnowledgeBaseBucket2114C0EE), which is neither readable nor
        // guaranteed stable if the construct is ever moved.
        stableOutput(this, 'TdirKbId', this.knowledgeBaseId, 'Knowledge base id');
        stableOutput(this, 'TdirKbBucket', this.dataBucket.bucketName, 'Knowledge base source bucket');
        stableOutput(
            this,
            'TdirKbDataSourceId',
            this.dataSource.attrDataSourceId,
            'Data source id, required by StartIngestionJob when recovering the corpus',
        );

        NagSuppressions.addResourceSuppressions(
            kbRole,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Knowledge base role needs access to all objects in the data bucket and its own S3 Vectors index',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            this.dataBucket,
            [
                {
                    id: 'AwsSolutions-S1',
                    reason: 'Access logs not required for workshop knowledge base bucket',
                },
            ],
            true,
        );
    }
}
