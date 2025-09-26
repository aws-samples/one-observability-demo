/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { CfnOutput, Fn } from 'aws-cdk-lib';
import { EventBus, IEventBus } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { EVENTBUS_ARN_EXPORT_NAME, EVENTBUS_NAME_EXPORT_NAME } from '../../bin/constants';

/**
 * Properties for configuring EventBusResources construct
 * @interface EventBusResourcesProperties
 */
export interface EventBusResourcesProperties {
    /**
     * The name of the EventBus
     * @default 'workshop-eventbus'
     */
    eventBusName?: string;
    /**
     * Description for the EventBus
     * @default 'Workshop EventBus for cross-service communication'
     */
    description?: string;
}

/**
 * AWS CDK Construct that creates EventBridge EventBus resources
 * @class EventBusResources
 * @extends Construct
 */
export class EventBusResources extends Construct {
    /**
     * The EventBridge EventBus
     * @public
     */
    public eventBus: EventBus;

    /**
     * Creates a new EventBusResources construct
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope: Construct, id: string, properties?: EventBusResourcesProperties) {
        super(scope, id);

        this.eventBus = new EventBus(this, 'WorkshopEventBus', {
            eventBusName: properties?.eventBusName || 'workshop-eventbus',
            description: properties?.description || 'Workshop EventBus for cross-service communication',
        });

        // Create CloudFormation outputs for EventBus resources
        this.createEventBusOutputs();
    }

    /**
     * Imports EventBus resources from CloudFormation exports created by EventBusResources
     *
     * @param scope - The construct scope where the resources will be imported
     * @param id - The construct identifier for the imported resources
     * @returns Object containing the imported EventBus
     */
    public static importFromExports(scope: Construct, id: string): { eventBus: IEventBus } {
        const eventBusArn = Fn.importValue(EVENTBUS_ARN_EXPORT_NAME);
        const eventBus = EventBus.fromEventBusArn(scope, `${id}-EventBus`, eventBusArn);

        return { eventBus };
    }

    /**
     * Creates CloudFormation outputs for EventBus resources
     */
    private createEventBusOutputs() {
        new CfnOutput(this, 'EventBusArn', {
            value: this.eventBus.eventBusArn,
            exportName: EVENTBUS_ARN_EXPORT_NAME,
        });
        new CfnOutput(this, 'EventBusName', {
            value: this.eventBus.eventBusName,
            exportName: EVENTBUS_NAME_EXPORT_NAME,
        });
    }
}
