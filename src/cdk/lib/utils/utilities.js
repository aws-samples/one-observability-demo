"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkshopNagPack = exports.Utilities = void 0;
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
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const aws_ssm_1 = require("aws-cdk-lib/aws-ssm");
/**
 * Utility class providing helper functions for common CDK operations.
 *
 * This class contains static methods for tagging resources and retrieving
 * CDK lookup role ARNs.
 */
exports.Utilities = {
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
    TagConstruct(object, tags) {
        // Apply tags to the construct
        for (const [key, value] of Object.entries(tags)) {
            aws_cdk_lib_1.Tags.of(object).add(key, value);
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
    FindChildNodes(construct, partialName, resourceType) {
        const matches = [];
        function searchRecursively(node) {
            // Check if current node is a CfnResource with matching name and optionally matching type
            if (node instanceof aws_cdk_lib_1.CfnResource &&
                node.toString().includes(partialName) &&
                (!resourceType || node.cfnResourceType === resourceType)) {
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
    SuppressLogRetentionNagWarnings(construct) {
        const logRetentionRole = this.FindChildNodes(construct, 'LogRetention', 'AWS::IAM::Role');
        for (const role of logRetentionRole) {
            const serviceRole = role;
            cdk_nag_1.NagSuppressions.addResourceSuppressions(serviceRole, [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Log Retention lambda using managed policies is acceptable',
                },
            ], true);
        }
        const logRetentionPolicy = this.FindChildNodes(construct, 'LogRetention', 'AWS::IAM::Policy');
        for (const policy of logRetentionPolicy) {
            const serviceRole = policy;
            cdk_nag_1.NagSuppressions.addResourceSuppressions(serviceRole, [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Log Retention lambda using wildcard is acceptable',
                },
            ], true);
        }
    },
    SuppressKubectlProviderNagWarnings(construct) {
        const kubectlProvider = this.FindChildNodes(construct, 'KubectlProvider');
        for (const resource of kubectlProvider) {
            cdk_nag_1.NagSuppressions.addResourceSuppressions(resource, [
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
            ], true);
        }
    },
    createSsmParameters(scope, prefix, parameters) {
        for (const [key, value] of parameters.entries()) {
            //const id = key.replace('/', '_');
            const fullKey = `${prefix}/${key}`;
            new aws_ssm_1.StringParameter(scope, fullKey, { parameterName: fullKey, stringValue: value });
        }
    },
    createOuputs(scope, parameters) {
        for (const [key, value] of parameters.entries()) {
            new aws_cdk_lib_1.CfnOutput(scope, key, { value: value });
        }
    },
};
var workshop_nag_pack_1 = require("./workshop-nag-pack");
Object.defineProperty(exports, "WorkshopNagPack", { enumerable: true, get: function () { return workshop_nag_pack_1.WorkshopNagPack; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbGl0aWVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidXRpbGl0aWVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7RUFHRTtBQUNGOzs7Ozs7O0dBT0c7QUFDSCw2Q0FBMkQ7QUFFM0QscUNBQTBDO0FBRTFDLGlEQUFzRDtBQUV0RDs7Ozs7R0FLRztBQUNVLFFBQUEsU0FBUyxHQUFHO0lBQ3JCOzs7Ozs7Ozs7T0FTRztJQUNILFlBQVksQ0FBQyxNQUFpQixFQUFFLElBQStCO1FBQzNELDhCQUE4QjtRQUM5QixLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQzlDLGtCQUFJLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDcEMsQ0FBQztRQUVELHVDQUF1QztRQUN2QyxLQUFLLE1BQU0sS0FBSyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDdkMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDbkMsQ0FBQztJQUNMLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsY0FBYyxDQUFDLFNBQW9CLEVBQUUsV0FBbUIsRUFBRSxZQUFxQjtRQUMzRSxNQUFNLE9BQU8sR0FBZ0IsRUFBRSxDQUFDO1FBRWhDLFNBQVMsaUJBQWlCLENBQUMsSUFBZTtZQUN0Qyx5RkFBeUY7WUFDekYsSUFDSSxJQUFJLFlBQVkseUJBQVc7Z0JBQzNCLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDO2dCQUNyQyxDQUFDLENBQUMsWUFBWSxJQUFJLElBQUksQ0FBQyxlQUFlLEtBQUssWUFBWSxDQUFDLEVBQzFELENBQUM7Z0JBQ0MsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENB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Q0osQ0FBQztBQUVGLHlEQUFzRDtBQUE3QyxvSEFBQSxlQUFlLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuQ29weXJpZ2h0IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG5TUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuKi9cbi8qKlxuICogVXRpbGl0aWVzIG1vZHVsZSBwcm92aWRlcyBoZWxwZXIgZnVuY3Rpb25zIGZvciBjb21tb24gQ0RLIG9wZXJhdGlvbnMuXG4gKlxuICogVGhpcyBtb2R1bGUgY29udGFpbnMgc3RhdGljIHV0aWxpdHkgZnVuY3Rpb25zIGZvciB0YWdnaW5nIHJlc291cmNlcyBhbmRcbiAqIHJldHJpZXZpbmcgQ0RLIGxvb2t1cCByb2xlIEFSTnMuXG4gKlxuICogQHBhY2thZ2VEb2N1bWVudGF0aW9uXG4gKi9cbmltcG9ydCB7IENmbk91dHB1dCwgQ2ZuUmVzb3VyY2UsIFRhZ3MgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgUG9saWN5LCBSb2xlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBTdHJpbmdQYXJhbWV0ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcblxuLyoqXG4gKiBVdGlsaXR5IGNsYXNzIHByb3ZpZGluZyBoZWxwZXIgZnVuY3Rpb25zIGZvciBjb21tb24gQ0RLIG9wZXJhdGlvbnMuXG4gKlxuICogVGhpcyBjbGFzcyBjb250YWlucyBzdGF0aWMgbWV0aG9kcyBmb3IgdGFnZ2luZyByZXNvdXJjZXMgYW5kIHJldHJpZXZpbmdcbiAqIENESyBsb29rdXAgcm9sZSBBUk5zLlxuICovXG5leHBvcnQgY29uc3QgVXRpbGl0aWVzID0ge1xuICAgIC8qKlxuICAgICAqIEFkZHMgdGFncyB0byBhIGNvbnN0cnVjdCBhbmQgYWxsIGl0cyBjaGlsZHJlbiByZWN1cnNpdmVseS5cbiAgICAgKlxuICAgICAqIFRoaXMgbWV0aG9kIGFwcGxpZXMgdGFncyB0byBib3RoIHRoZSBDREsgY29uc3RydWN0IGFuZCB0aGUgdW5kZXJseWluZyBDbG91ZEZvcm1hdGlvblxuICAgICAqIHJlc291cmNlcy4gRm9yIENsb3VkRm9ybWF0aW9uIHJlc291cmNlcywgaXQgY2hlY2tzIGlmIHRoZSByZXNvdXJjZSB0eXBlIHN1cHBvcnRzXG4gICAgICogdGFnZ2luZyBiZWZvcmUgYXBwbHlpbmcgdGFncy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBvYmplY3QgLSBUaGUgY29uc3RydWN0IHRvIHdoaWNoIHRhZ3Mgd2lsbCBiZSBhcHBsaWVkXG4gICAgICogQHBhcmFtIHRhZ3MgLSBNYXAgb2YgdGFnIGtleXMgYW5kIHZhbHVlcyB0byBhcHBseVxuICAgICAqL1xuICAgIFRhZ0NvbnN0cnVjdChvYmplY3Q6IENvbnN0cnVjdCwgdGFnczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSkge1xuICAgICAgICAvLyBBcHBseSB0YWdzIHRvIHRoZSBjb25zdHJ1Y3RcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGFncykpIHtcbiAgICAgICAgICAgIFRhZ3Mub2Yob2JqZWN0KS5hZGQoa2V5LCB2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWN1cnNpdmVseSB0YWcgYWxsIGNoaWxkIGNvbnN0cnVjdHNcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBvYmplY3Qubm9kZS5jaGlsZHJlbikge1xuICAgICAgICAgICAgdGhpcy5UYWdDb25zdHJ1Y3QoY2hpbGQsIHRhZ3MpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFJlY3Vyc2l2ZWx5IHNlYXJjaGVzIGZvciBjaGlsZCBub2RlcyBpbiBhIGNvbnN0cnVjdCBieSByZXNvdXJjZSB0eXBlIGFuZCBwYXJ0aWFsIG5hbWUgbWF0Y2guXG4gICAgICpcbiAgICAgKiBAcGFyYW0gY29uc3RydWN0IC0gVGhlIHJvb3QgY29uc3RydWN0IHRvIHNlYXJjaCB3aXRoaW5cbiAgICAgKiBAcGFyYW0gcGFydGlhbE5hbWUgLSBQYXJ0aWFsIG1hdGNoIHN0cmluZyBmb3IgdGhlIHJlc291cmNlIG5hbWVcbiAgICAgKiBAcGFyYW0gcmVzb3VyY2VUeXBlIC0gT3B0aW9uYWwgQ2xvdWRGb3JtYXRpb24gcmVzb3VyY2UgdHlwZSB0byBzZWFyY2ggZm9yIChlLmcuLCAnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJylcbiAgICAgKiBAcmV0dXJucyBBcnJheSBvZiBtYXRjaGluZyBjb25zdHJ1Y3RzXG4gICAgICovXG4gICAgRmluZENoaWxkTm9kZXMoY29uc3RydWN0OiBDb25zdHJ1Y3QsIHBhcnRpYWxOYW1lOiBzdHJpbmcsIHJlc291cmNlVHlwZT86IHN0cmluZyk6IENvbnN0cnVjdFtdIHtcbiAgICAgICAgY29uc3QgbWF0Y2hlczogQ29uc3RydWN0W10gPSBbXTtcblxuICAgICAgICBmdW5jdGlvbiBzZWFyY2hSZWN1cnNpdmVseShub2RlOiBDb25zdHJ1Y3QpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGN1cnJlbnQgbm9kZSBpcyBhIENmblJlc291cmNlIHdpdGggbWF0Y2hpbmcgbmFtZSBhbmQgb3B0aW9uYWxseSBtYXRjaGluZyB0eXBlXG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgbm9kZSBpbnN0YW5jZW9mIENmblJlc291cmNlICYmXG4gICAgICAgICAgICAgICAgbm9kZS50b1N0cmluZygpLmluY2x1ZGVzKHBhcnRpYWxOYW1lKSAmJlxuICAgICAgICAgICAgICAgICghcmVzb3VyY2VUeXBlIHx8IG5vZGUuY2ZuUmVzb3VyY2VUeXBlID09PSByZXNvdXJjZVR5cGUpXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBtYXRjaGVzLnB1c2gobm9kZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFJlY3Vyc2l2ZWx5IHNlYXJjaCBhbGwgY2hpbGRyZW5cbiAgICAgICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5ub2RlLmNoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgc2VhcmNoUmVjdXJzaXZlbHkoY2hpbGQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgc2VhcmNoUmVjdXJzaXZlbHkoY29uc3RydWN0KTtcbiAgICAgICAgcmV0dXJuIG1hdGNoZXM7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIEFwcGxpZXMgTkFHIHN1cHByZXNzaW9ucyB0byBsb2cgcmV0ZW50aW9uIHJlc291cmNlcyBpbiBhIGNvbnN0cnVjdC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBjb25zdHJ1Y3QgLSBUaGUgY29uc3RydWN0IHRvIHNlYXJjaCBmb3IgbG9nIHJldGVudGlvbiByZXNvdXJjZXNcbiAgICAgKi9cbiAgICBTdXBwcmVzc0xvZ1JldGVudGlvbk5hZ1dhcm5pbmdzKGNvbnN0cnVjdDogQ29uc3RydWN0KSB7XG4gICAgICAgIGNvbnN0IGxvZ1JldGVudGlvblJvbGUgPSB0aGlzLkZpbmRDaGlsZE5vZGVzKGNvbnN0cnVjdCwgJ0xvZ1JldGVudGlvbicsICdBV1M6OklBTTo6Um9sZScpO1xuICAgICAgICBmb3IgKGNvbnN0IHJvbGUgb2YgbG9nUmV0ZW50aW9uUm9sZSkge1xuICAgICAgICAgICAgY29uc3Qgc2VydmljZVJvbGUgPSByb2xlIGFzIFJvbGU7XG4gICAgICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICAgICAgc2VydmljZVJvbGUsXG4gICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0xvZyBSZXRlbnRpb24gbGFtYmRhIHVzaW5nIG1hbmFnZWQgcG9saWNpZXMgaXMgYWNjZXB0YWJsZScsXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB0cnVlLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxvZ1JldGVudGlvblBvbGljeSA9IHRoaXMuRmluZENoaWxkTm9kZXMoY29uc3RydWN0LCAnTG9nUmV0ZW50aW9uJywgJ0FXUzo6SUFNOjpQb2xpY3knKTtcbiAgICAgICAgZm9yIChjb25zdCBwb2xpY3kgb2YgbG9nUmV0ZW50aW9uUG9saWN5KSB7XG4gICAgICAgICAgICBjb25zdCBzZXJ2aWNlUm9sZSA9IHBvbGljeSBhcyBQb2xpY3k7XG4gICAgICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICAgICAgc2VydmljZVJvbGUsXG4gICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0xvZyBSZXRlbnRpb24gbGFtYmRhIHVzaW5nIHdpbGRjYXJkIGlzIGFjY2VwdGFibGUnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgU3VwcHJlc3NLdWJlY3RsUHJvdmlkZXJOYWdXYXJuaW5ncyhjb25zdHJ1Y3Q6IENvbnN0cnVjdCkge1xuICAgICAgICBjb25zdCBrdWJlY3RsUHJvdmlkZXIgPSB0aGlzLkZpbmRDaGlsZE5vZGVzKGNvbnN0cnVjdCwgJ0t1YmVjdGxQcm92aWRlcicpO1xuICAgICAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIGt1YmVjdGxQcm92aWRlcikge1xuICAgICAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgICAgICAgICAgIHJlc291cmNlLFxuICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgICAgICAgICAgICAgICAgICByZWFzb246ICdrdWJlY3RsIGxhbWJkYSB1c2luZyBtYW5hZ2VkIHBvbGljaWVzIGlzIGFjY2VwdGFibGUnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0t1YmVjdGwgbGFtYmRhIHVzaW5nIHdpbGRjYXJkIGlzIGFjY2VwdGFibGUnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1MMScsXG4gICAgICAgICAgICAgICAgICAgICAgICByZWFzb246ICdLdWJlY3RsIGxhbWJkYSBtYW5hZ2VkIGJ5IEVLUyBDb25zdHJ1Y3QnLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ1dvcmtzaG9wLUNXTDInLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnS3ViZWN0bCBsYW1iZGEgbWFuYWdlZCBieSBFS1MgQ29uc3RydWN0JyxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHRydWUsXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIGNyZWF0ZVNzbVBhcmFtZXRlcnMoc2NvcGU6IENvbnN0cnVjdCwgcHJlZml4OiBzdHJpbmcsIHBhcmFtZXRlcnM6IE1hcDxzdHJpbmcsIHN0cmluZz4pIHtcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgcGFyYW1ldGVycy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIC8vY29uc3QgaWQgPSBrZXkucmVwbGFjZSgnLycsICdfJyk7XG4gICAgICAgICAgICBjb25zdCBmdWxsS2V5ID0gYCR7cHJlZml4fS8ke2tleX1gO1xuICAgICAgICAgICAgbmV3IFN0cmluZ1BhcmFtZXRlcihzY29wZSwgZnVsbEtleSwgeyBwYXJhbWV0ZXJOYW1lOiBmdWxsS2V5LCBzdHJpbmdWYWx1ZTogdmFsdWUgfSk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgY3JlYXRlT3VwdXRzKHNjb3BlOiBDb25zdHJ1Y3QsIHBhcmFtZXRlcnM6IE1hcDxzdHJpbmcsIHN0cmluZz4pIHtcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgcGFyYW1ldGVycy5lbnRyaWVzKCkpIHtcbiAgICAgICAgICAgIG5ldyBDZm5PdXRwdXQoc2NvcGUsIGtleSwgeyB2YWx1ZTogdmFsdWUgfSk7XG4gICAgICAgIH1cbiAgICB9LFxufTtcblxuZXhwb3J0IHsgV29ya3Nob3BOYWdQYWNrIH0gZnJvbSAnLi93b3Jrc2hvcC1uYWctcGFjayc7XG4iXX0=