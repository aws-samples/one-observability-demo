/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
/**
 * Utilities module provides helper functions for common CDK operations.
 *
 * This module contains static utility functions for tagging resources and
 * retrieving CDK lookup role ARNs.
 *
 * @packageDocumentation
 */
import { CfnOutput, CfnResource, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { Policy, Role } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { WorkshopNagPack } from './workshop-nag-pack';

/**
 * Utility class providing helper functions for common CDK operations.
 *
 * This class contains static methods for tagging resources and retrieving
 * CDK lookup role ARNs.
 */
export const Utilities = {
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
    TagConstruct(object: Construct, tags: { [key: string]: string }) {
        // Apply tags to the construct
        for (const [key, value] of Object.entries(tags)) {
            Tags.of(object).add(key, value);
        }

        // Recursively tag all child constructs
        for (const child of object.node.children) {
            this.TagConstruct(child, tags);
        }
    },

    /**
     * Recursively searches for child nodes in a construct by resource type and partial name match.
     *
     * @param construct - The root construct to search within
     * @param partialName - Partial match string for the resource name
     * @param resourceType - Optional CloudFormation resource type to search for (e.g., 'AWS::Lambda::Function')
     * @returns Array of matching constructs
     */
    FindChildNodes(construct: Construct, partialName: string, resourceType?: string): Construct[] {
        const matches: Construct[] = [];

        function searchRecursively(node: Construct) {
            // Check if current node is a CfnResource with matching name and optionally matching type
            if (
                node instanceof CfnResource &&
                node.toString().includes(partialName) &&
                (!resourceType || node.cfnResourceType === resourceType)
            ) {
                matches.push(node);
            }

            // Recursively search all children
            for (const child of node.node.children) {
                searchRecursively(child);
            }
        }

        searchRecursively(construct);
        return matches;
    },

    /**
     * Applies NAG suppressions to log retention resources in a construct.
     *
     * @param construct - The construct to search for log retention resources
     */
    SuppressLogRetentionNagWarnings(construct: Construct) {
        const logRetentionRole = this.FindChildNodes(construct, 'LogRetention', 'AWS::IAM::Role');
        for (const role of logRetentionRole) {
            const serviceRole = role as Role;
            NagSuppressions.addResourceSuppressions(
                serviceRole,
                [
                    {
                        id: 'AwsSolutions-IAM4',
                        reason: 'Log Retention lambda using managed policies is acceptable',
                    },
                ],
                true,
            );
        }

        const logRetentionPolicy = this.FindChildNodes(construct, 'LogRetention', 'AWS::IAM::Policy');
        for (const policy of logRetentionPolicy) {
            const serviceRole = policy as Policy;
            NagSuppressions.addResourceSuppressions(
                serviceRole,
                [
                    {
                        id: 'AwsSolutions-IAM5',
                        reason: 'Log Retention lambda using wildcard is acceptable',
                    },
                ],
                true,
            );
        }
    },

    SuppressKubectlProviderNagWarnings(construct: Construct) {
        const kubectlProvider = this.FindChildNodes(construct, 'KubectlProvider');
        for (const resource of kubectlProvider) {
            NagSuppressions.addResourceSuppressions(
                resource,
                [
                    {
                        id: 'AwsSolutions-IAM4',
                        reason: 'kubectl lambda using managed policies is acceptable',
                    },
                    {
                        id: 'AwsSolutions-IAM5',
                        reason: 'Kubectl lambda using wildcard is acceptable',
                    },
                    {
                        id: 'AwsSolutions-L1',
                        reason: 'Kubectl lambda managed by EKS Construct',
                    },
                    {
                        id: 'Workshop-CWL2',
                        reason: 'Kubectl lambda managed by EKS Construct',
                    },
                ],
                true,
            );
        }
    },

    createSsmParameters(scope: Construct, prefix: string, parameters: Map<string, string>) {
        for (const [key, value] of parameters.entries()) {
            //const id = key.replace('/', '_');
            const fullKey = `${prefix}/${key}`;
            new StringParameter(scope, fullKey, { parameterName: fullKey, stringValue: value });
        }
    },

    createOuputs(scope: Construct, parameters: Map<string, string>) {
        for (const [key, value] of parameters.entries()) {
            new CfnOutput(scope, key, { value: value });
        }
    },

    /**
     * Applies the Workshop NAG pack to validate resource deletion configuration.
     *
     * @param construct - The construct to apply workshop validation rules to
     */
    ApplyWorkshopNagPack(construct: Construct) {
        const workshopPack = new WorkshopNagPack();
        workshopPack.visit(construct);
    },
};

export { WorkshopNagPack } from './workshop-nag-pack';
