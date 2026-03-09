/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Amazon EventBridge construct for the One Observability Workshop.
 *
 * Creates a custom event bus used for event-driven communication between services:
 *
 * - The **petfood-rs** service emits food creation, stock purchase, and item discontinuation events
 * - The **petfood-stock-processor** Lambda processes stock events
 * - The **petfood-image-generator** Lambda generates images for new food items
 * - The **petfood-cleanup-processor** Lambda handles resource cleanup on deletion
 *
 * EventBridge provides built-in observability through CloudWatch metrics for
 * invocations, failed invocations, and throttled rules.
 *
 * > **Best practice**: Using a custom event bus (vs. the default bus) isolates workshop
 * > events and enables fine-grained IAM policies and event archive/replay capabilities.
 *
 * @packageDocumentation
 */
import { CfnOutput, Fn } from 'aws-cdk-lib';
import { EventBus, IEventBus } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { EVENTBUS_ARN_EXPORT_NAME, EVENTBUS_NAME_EXPORT_NAME, SSM_PARAMETER_NAMES } from '../../bin/constants';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';

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

        // Create SSM parameters for queue resources
        this.createSsmParameters();
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
            description: 'ARN of the EventBridge event bus for cross-service communication',
        });
        new CfnOutput(this, 'EventBusName', {
            value: this.eventBus.eventBusName,
            exportName: EVENTBUS_NAME_EXPORT_NAME,
            description: 'Name of the EventBridge event bus',
        });
    }

    /**
     * Creates SSM parameters for queue resources
     */
    private createSsmParameters(): void {
        if (this.eventBus) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.EVENT_BUS_NAME]: this.eventBus.eventBusName,
                    }),
                ),
            );
        } else {
            throw new Error('Queue is not available');
        }
    }
}
