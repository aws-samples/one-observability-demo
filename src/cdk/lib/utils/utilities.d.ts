import { Construct } from 'constructs';
/**
 * Utility class providing helper functions for common CDK operations.
 *
 * This class contains static methods for tagging resources and retrieving
 * CDK lookup role ARNs.
 */
export declare const Utilities: {
    /**
     * Adds tags to a construct and all its children recursively.
     *
     * This method applies tags to both the CDK construct and the underlying CloudFormation
     * resources. For CloudFormation resources, it checks if the resource type supports
     * tagging before applying tags.
     *
     * @param object - The construct to which tags will be applied
     * @param tags - Map of tag keys and values to apply
     */
    TagConstruct(object: Construct, tags: {
        [key: string]: string;
    }): void;
    /**
     * Recursively searches for child nodes in a construct by resource type and partial name match.
     *
     * @param construct - The root construct to search within
     * @param partialName - Partial match string for the resource name
     * @param resourceType - Optional CloudFormation resource type to search for (e.g., 'AWS::Lambda::Function')
     * @returns Array of matching constructs
     */
    FindChildNodes(construct: Construct, partialName: string, resourceType?: string): Construct[];
    /**
     * Applies NAG suppressions to log retention resources in a construct.
     *
     * @param construct - The construct to search for log retention resources
     */
    SuppressLogRetentionNagWarnings(construct: Construct): void;
    SuppressKubectlProviderNagWarnings(construct: Construct): void;
    createSsmParameters(scope: Construct, prefix: string, parameters: Map<string, string>): void;
    createOuputs(scope: Construct, parameters: Map<string, string>): void;
};
export { WorkshopNagPack } from './workshop-nag-pack';
