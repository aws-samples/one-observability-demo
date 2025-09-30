import { CfnApplication } from 'aws-cdk-lib/aws-opensearchservice';
import { Construct } from 'constructs';
import { OpenSearchCollection } from './opensearch-collection';
/**
 * Properties for configuring OpenSearchApplication construct
 * @interface OpenSearchApplicationProperties
 */
export interface OpenSearchApplicationProperties {
    /**
     * Name of the OpenSearch UI Application
     * @default 'petadoption-ui-app'
     */
    applicationName?: string;
    /**
     * The OpenSearch collection to use as data source
     */
    collection: OpenSearchCollection;
    /**
     * Application configuration settings
     * @optional
     */
    appConfig?: {
        [key: string]: string;
    };
    /**
     * IAM Identity Center options
     * @optional
     */
    iamIdentityCenterOptions?: {
        enabled?: boolean;
        identityStoreId?: string;
    };
}
/**
 * AWS CDK Construct that creates OpenSearch UI Application for pet adoption data visualization
 * @class OpenSearchApplication
 * @extends Construct
 */
export declare class OpenSearchApplication extends Construct {
    /**
     * The OpenSearch UI Application for visualizing pet adoption data
     * @public
     */
    application: CfnApplication;
    /**
     * The application endpoint URL
     * @public
     */
    applicationEndpoint: string;
    /**
     * Creates a new OpenSearchApplication construct with UI application
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (required)
     */
    constructor(scope: Construct, id: string, properties: OpenSearchApplicationProperties);
    private createExports;
    static importFromExports(): {
        applicationArn: string;
        applicationId: string;
    };
    createOutputs(): void;
}
