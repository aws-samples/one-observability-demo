/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Amazon Bedrock Knowledge Base construct for the One Observability Workshop.
 *
 * This module provisions a Bedrock Knowledge Base backed by an S3 data source
 * containing pet food product information. The knowledge base is used by the
 * Pet Food AI Agent for retrieval-augmented generation (RAG).
 *
 * In the TDIR workshop scenario, this knowledge base represents a target for
 * "knowledge base corruption" attacks where adversarial content is injected
 * into the data source to manipulate agent responses.
 *
 * @packageDocumentation
 */

import { Construct } from 'constructs';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Bucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Role, ServicePrincipal, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { CfnKnowledgeBase, CfnDataSource } from 'aws-cdk-lib/aws-bedrock';
import { NagSuppressions } from 'cdk-nag';

/**
 * Configuration properties for the WorkshopKnowledgeBase construct.
 */
export interface WorkshopKnowledgeBaseProperties {
    /** Embedding model ID for vectorizing documents */
    embeddingModelId?: string;
    /** Tags to apply to resources */
    tags?: { [key: string]: string };
}

/**
 * A CDK construct that creates a Bedrock Knowledge Base with an S3 data source
 * for the pet food AI agent's retrieval-augmented generation.
 *
 * The knowledge base uses:
 * - S3 bucket for storing product documents
 * - Bedrock embedding model for vectorization
 * - Built-in vector store for similarity search
 *
 * Workshop participants investigate this knowledge base for signs of
 * data corruption (adversarial document injection).
 */
export class WorkshopKnowledgeBase extends Construct {
    /** The S3 bucket containing knowledge base documents */
    public readonly dataBucket: Bucket;
    /** The Bedrock Knowledge Base */
    public readonly knowledgeBase: CfnKnowledgeBase;
    /** The data source connecting S3 to the knowledge base */
    public readonly dataSource: CfnDataSource;

    /**
     * Creates a new WorkshopKnowledgeBase construct.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the knowledge base
     */
    constructor(scope: Construct, id: string, properties?: WorkshopKnowledgeBaseProperties) {
        super(scope, id);

        const props = properties || {};
        const embeddingModelId = props.embeddingModelId || 'amazon.titan-embed-text-v2:0';
        const region = Stack.of(this).region;
        const account = Stack.of(this).account;

        // S3 bucket for knowledge base documents
        this.dataBucket = new Bucket(this, 'DataBucket', {
            encryption: BucketEncryption.S3_MANAGED,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: true, // Versioning helps detect corruption
        });

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
                resources: [`arn:aws:bedrock:${region}::foundation-model/${embeddingModelId}`],
            }),
        );

        kbRole.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['s3:GetObject', 's3:ListBucket'],
                resources: [this.dataBucket.bucketArn, `${this.dataBucket.bucketArn}/*`],
            }),
        );

        // Knowledge Base with built-in vector store
        this.knowledgeBase = new CfnKnowledgeBase(this, 'KnowledgeBase', {
            name: 'petfood-product-knowledge',
            description: 'Pet food product information for the AI recommendation agent',
            roleArn: kbRole.roleArn,
            knowledgeBaseConfiguration: {
                type: 'VECTOR',
                vectorKnowledgeBaseConfiguration: {
                    embeddingModelArn: `arn:aws:bedrock:${region}::foundation-model/${embeddingModelId}`,
                },
            },
            storageConfiguration: {
                type: 'INTERNAL',
            },
        });

        // Data source connecting S3 bucket to the knowledge base
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

        NagSuppressions.addResourceSuppressions(
            kbRole,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Knowledge base role needs access to all objects in the data bucket',
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
