import { EventBus, IEventBus } from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
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
export declare class EventBusResources extends Construct {
    /**
     * The EventBridge EventBus
     * @public
     */
    eventBus: EventBus;
    /**
     * Creates a new EventBusResources construct
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct
     */
    constructor(scope: Construct, id: string, properties?: EventBusResourcesProperties);
    /**
     * Imports EventBus resources from CloudFormation exports created by EventBusResources
     *
     * @param scope - The construct scope where the resources will be imported
     * @param id - The construct identifier for the imported resources
     * @returns Object containing the imported EventBus
     */
    static importFromExports(scope: Construct, id: string): {
        eventBus: IEventBus;
    };
    /**
     * Creates CloudFormation outputs for EventBus resources
     */
    private createEventBusOutputs;
}
