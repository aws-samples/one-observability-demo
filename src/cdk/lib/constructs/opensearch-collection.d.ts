import { CfnCollection, CfnSecurityPolicy, CfnAccessPolicy } from 'aws-cdk-lib/aws-opensearchserverless';
import { IRole } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
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
    /**
     * Roles that need access to ingest data into the OpenSearch collection
     * @optional
     */
    ingestionRoles?: IRole[];
}
/**
 * AWS CDK Construct that creates OpenSearch Serverless collection with CloudWatch alarms for pet adoption
 * @class OpenSearchCollection
 * @extends Construct
 */
export declare class OpenSearchCollection extends Construct {
    /**
     * The OpenSearch Serverless collection for storing pet adoption data
     * @public
     */
    collection: CfnCollection;
    /**
     * The security policy for the collection
     * @public
     */
    securityPolicy: CfnSecurityPolicy;
    /**
     * The access policy for the collection
     * @public
     */
    accessPolicy: CfnAccessPolicy;
    /**
     * Creates a new OpenSearchCollection construct with collection
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (optional)
     */
    constructor(scope: Construct, id: string, properties?: OpenSearchCollectionProperties);
    private createExports;
    static importFromExports(): {
        collectionArn: string;
        collectionId: string;
        collectionEndpoint: string;
    };
    /**
     * Add additional ingestion roles to the access policy
     * @param roles - Array of IAM roles to grant access
     */
    addIngestionRoles(roles: IRole[]): void;
    createOutputs(): void;
}
