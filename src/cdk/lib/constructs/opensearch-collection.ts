/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnOutput, Fn } from 'aws-cdk-lib';
import { CfnCollection, CfnSecurityPolicy, CfnAccessPolicy } from 'aws-cdk-lib/aws-opensearchserverless';
import { Construct } from 'constructs';
import {
    OPENSEARCH_COLLECTION_ARN_EXPORT_NAME,
    OPENSEARCH_COLLECTION_ID_EXPORT_NAME,
    OPENSEARCH_COLLECTION_ENDPOINT_EXPORT_NAME,
} from '../../bin/constants';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';

/**
 * Properties for configuring OpenSearchCollection construct
 * @interface OpenSearchCollectionProperties
 */
export interface OpenSearchCollectionProperties {
    /**
     * Name of the OpenSearch Serverless collection
     * @default 'petadoption-collection'
     */
    collectionName?: string;
    /**
     * Description for the OpenSearch Serverless collection
     * @default 'Pet adoption data collection'
     */
    description?: string;
    /**
     * Type of the OpenSearch Serverless collection
     * @default 'TIMESERIES'
     */
    type?: 'SEARCH' | 'TIMESERIES' | 'VECTORSEARCH';
}

/**
 * AWS CDK Construct that creates OpenSearch Serverless collection with CloudWatch alarms for pet adoption
 * @class OpenSearchCollection
 * @extends Construct
 */
export class OpenSearchCollection extends Construct {
    /**
     * The OpenSearch Serverless collection for storing pet adoption data
     * @public
     */
    public collection: CfnCollection;

    /**
     * The security policy for the collection
     * @public
     */
    public securityPolicy: CfnSecurityPolicy;

    /**
     * The access policy for the collection
     * @public
     */
    public accessPolicy: CfnAccessPolicy;

    /**
     * Creates a new OpenSearchCollection construct with collection
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (optional)
     */
    constructor(scope: Construct, id: string, properties?: OpenSearchCollectionProperties) {
        super(scope, id);

        const collectionName = properties?.collectionName || 'petadoption-collection';
        const description = properties?.description || 'Pet adoption data collection';
        const type = properties?.type || 'TIMESERIES';

        // Create security policy for encryption
        this.securityPolicy = new CfnSecurityPolicy(this, 'SecurityPolicy', {
            name: `${collectionName}-security-policy`,
            type: 'encryption',
            policy: JSON.stringify({
                Rules: [
                    {
                        ResourceType: 'collection',
                        Resource: [`collection/${collectionName}`],
                    },
                ],
                AWSOwnedKey: true,
            }),
        });

        // Create network security policy
        const networkSecurityPolicy = new CfnSecurityPolicy(this, 'NetworkSecurityPolicy', {
            name: `${collectionName}-network-policy`,
            type: 'network',
            policy: JSON.stringify([
                {
                    Rules: [
                        {
                            ResourceType: 'collection',
                            Resource: [`collection/${collectionName}`],
                        },
                        {
                            ResourceType: 'dashboard',
                            Resource: [`collection/${collectionName}`],
                        },
                    ],
                    AllowFromPublic: false,
                },
            ]),
        });

        // Create the OpenSearch Serverless collection
        this.collection = new CfnCollection(this, 'Collection', {
            name: collectionName,
            description: description,
            type: type,
        });

        // Add dependencies
        this.collection.addDependency(this.securityPolicy);
        this.collection.addDependency(networkSecurityPolicy);

        // Create access policy for the collection
        this.accessPolicy = new CfnAccessPolicy(this, 'AccessPolicy', {
            name: `${collectionName}-access-policy`,
            type: 'data',
            policy: JSON.stringify([
                {
                    Rules: [
                        {
                            ResourceType: 'collection',
                            Resource: [`collection/${collectionName}`],
                            Permission: [
                                'aoss:CreateCollectionItems',
                                'aoss:DeleteCollectionItems',
                                'aoss:UpdateCollectionItems',
                                'aoss:DescribeCollectionItems',
                            ],
                        },
                        {
                            ResourceType: 'index',
                            Resource: [`index/${collectionName}/*`],
                            Permission: [
                                'aoss:CreateIndex',
                                'aoss:DeleteIndex',
                                'aoss:UpdateIndex',
                                'aoss:DescribeIndex',
                                'aoss:ReadDocument',
                                'aoss:WriteDocument',
                            ],
                        },
                    ],
                    Principal: [`arn:aws:iam::*:root`],
                },
            ]),
        });

        // Add dependency for access policy
        this.accessPolicy.addDependency(this.collection);

        this.createExports();
        this.createOutputs();
    }

    private createExports(): void {
        new CfnOutput(this, 'CollectionArn', {
            value: this.collection.attrArn,
            exportName: OPENSEARCH_COLLECTION_ARN_EXPORT_NAME,
        });

        new CfnOutput(this, 'CollectionId', {
            value: this.collection.attrId,
            exportName: OPENSEARCH_COLLECTION_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'CollectionEndpoint', {
            value: this.collection.attrCollectionEndpoint,
            exportName: OPENSEARCH_COLLECTION_ENDPOINT_EXPORT_NAME,
        });
    }

    public static importFromExports(): {
        collectionArn: string;
        collectionId: string;
        collectionEndpoint: string;
    } {
        const collectionArn = Fn.importValue(OPENSEARCH_COLLECTION_ARN_EXPORT_NAME);
        const collectionId = Fn.importValue(OPENSEARCH_COLLECTION_ID_EXPORT_NAME);
        const collectionEndpoint = Fn.importValue(OPENSEARCH_COLLECTION_ENDPOINT_EXPORT_NAME);

        return {
            collectionArn,
            collectionId,
            collectionEndpoint,
        };
    }

    createOutputs(): void {
        if (this.collection) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        opensearchcollectionarn: this.collection.attrArn,
                        opensearchcollectionid: this.collection.attrId,
                        opensearchcollectionendpoint: this.collection.attrCollectionEndpoint,
                    }),
                ),
            );
        } else {
            throw new Error('OpenSearch collection is not available');
        }
    }
}
