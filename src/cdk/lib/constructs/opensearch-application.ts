/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnOutput, Fn } from 'aws-cdk-lib';
import { CfnApplication } from 'aws-cdk-lib/aws-opensearchservice';
import { Construct } from 'constructs';
import {
    OPENSEARCH_APPLICATION_ARN_EXPORT_NAME,
    OPENSEARCH_APPLICATION_ID_EXPORT_NAME,
} from '../../bin/constants';
import { OpenSearchCollection } from './opensearch-collection';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';

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
    appConfig?: { [key: string]: string };
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
export class OpenSearchApplication extends Construct {
    /**
     * The OpenSearch UI Application for visualizing pet adoption data
     * @public
     */
    public application: CfnApplication;

    /**
     * The application endpoint URL
     * @public
     */
    public applicationEndpoint: string;

    /**
     * Creates a new OpenSearchApplication construct with UI application
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (required)
     */
    constructor(scope: Construct, id: string, properties: OpenSearchApplicationProperties) {
        super(scope, id);

        const applicationName = properties.applicationName || 'petadoption-opensearch-ui';
        const collection = properties.collection;

        // Create the OpenSearch UI Application
        this.application = new CfnApplication(this, 'Application', {
            name: applicationName,
            dataSources: [
                {
                    dataSourceArn: collection.collection.attrArn,
                },
            ],
            iamIdentityCenterOptions: properties.iamIdentityCenterOptions || {
                enabled: false,
            },
        });

        // Add dependency to ensure collection is created before application
        this.application.addDependency(collection.collection);
        this.application.addDependency(collection.accessPolicy);

        this.createExports();
        this.createOutputs();
    }

    private createExports(): void {
        new CfnOutput(this, 'ApplicationArn', {
            value: this.application.attrArn,
            exportName: OPENSEARCH_APPLICATION_ARN_EXPORT_NAME,
        });

        new CfnOutput(this, 'ApplicationId', {
            value: this.application.attrId,
            exportName: OPENSEARCH_APPLICATION_ID_EXPORT_NAME,
        });
    }

    public static importFromExports(): {
        applicationArn: string;
        applicationId: string;
    } {
        const applicationArn = Fn.importValue(OPENSEARCH_APPLICATION_ARN_EXPORT_NAME);
        const applicationId = Fn.importValue(OPENSEARCH_APPLICATION_ID_EXPORT_NAME);

        return {
            applicationArn,
            applicationId,
        };
    }

    createOutputs(): void {
        if (this.application) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        opensearchapplicationarn: this.application.attrArn,
                        opensearchapplicationid: this.application.attrId,
                    }),
                ),
            );
        } else {
            throw new Error('OpenSearch Ui is not available');
        }
    }
}