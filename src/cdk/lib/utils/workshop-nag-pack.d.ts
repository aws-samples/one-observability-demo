import { IConstruct } from 'constructs';
import { NagPack, NagPackProps } from 'cdk-nag';
/**
 * Custom CDK-nag rule pack for workshop validation.
 * Ensures resources are configured for proper deletion when stack is destroyed.
 */
export declare class WorkshopNagPack extends NagPack {
    constructor(properties?: NagPackProps);
    visit(node: IConstruct): void;
    private checkCloudWatchLogGroupRetention;
    private checkCloudWatchLogGroupDeletion;
    private checkS3BucketDeletion;
    private checkS3BucketAutoDelete;
    private checkLambdaLogGroupAssociation;
    private checkForAutoDeleteObjects;
}
