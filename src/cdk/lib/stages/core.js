"use strict";
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreStack = exports.CoreStage = void 0;
/**
 * Core infrastructure stage and stack for the One Observability Workshop.
 *
 * This module defines the core infrastructure components including VPC setup,
 * networking configuration, and foundational resources needed for the workshop.
 *
 * @packageDocumentation
 */
const aws_cdk_lib_1 = require("aws-cdk-lib");
const utilities_1 = require("../utils/utilities");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
const network_1 = require("../constructs/network");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const cloudtrail_1 = require("../constructs/cloudtrail");
const queue_1 = require("../constructs/queue");
const eventbus_1 = require("../constructs/eventbus");
const aws_applicationsignals_1 = require("aws-cdk-lib/aws-applicationsignals");
const cloudwatch_1 = require("../constructs/cloudwatch");
/**
 * Core deployment stage containing the foundational infrastructure stack.
 *
 * This stage creates the core infrastructure needed for the One Observability
 * Workshop, including networking components and base resources.
 */
class CoreStage extends aws_cdk_lib_1.Stage {
    /**
     * Creates a new CoreStage.
     *
     * @param scope - The parent construct
     * @param id - The stage identifier
     * @param properties - Configuration properties for the stage
     */
    constructor(scope, id, properties) {
        super(scope, id);
        this.coreStack = new CoreStack(this, `Stack`, properties);
        if (properties.tags) {
            utilities_1.Utilities.TagConstruct(this.coreStack, properties.tags);
        }
    }
}
exports.CoreStage = CoreStage;
/**
 * Core infrastructure stack containing VPC and networking resources.
 *
 * This stack sets up the foundational networking infrastructure for the workshop,
 * either by creating a new VPC or using an existing one.
 */
class CoreStack extends aws_cdk_lib_1.Stack {
    /**
     * Creates a new CoreStack.
     *
     * @param scope - The parent construct
     * @param id - The stack identifier
     * @param properties - Configuration properties for the stack
     * @throws Error when neither createVpc nor vpcId is properly specified
     */
    constructor(scope, id, properties) {
        super(scope, id, properties);
        /** Add Queue resources */
        new queue_1.QueueResources(this, 'QueueResources', properties.queueProperties);
        /** Add EventBus resources */
        new eventbus_1.EventBusResources(this, 'EventBusResources', properties.eventBusProperties);
        /** Enable CloudWatch Application Signals Discovery */
        new aws_applicationsignals_1.CfnDiscovery(this, 'ApplicationSignals', {});
        /** CloudWatch Transaction Search setup **/
        new cloudwatch_1.CloudWatchTransactionSearch(this, 'CloudWatchTransactionSearch', properties.cloudWatchProperties);
        if (!properties.createVpc || properties.createVpc) {
            // Create a new VPC with workshop networking configuration
            this.externalVpc = false;
            const vpc = new network_1.WorkshopNetwork(this, 'vpc', {
                name: 'Workshop',
                cidrRange: properties.vpcCidr || '10.0.0.0/16',
                logRetentionDays: properties.defaultRetentionDays || aws_logs_1.RetentionDays.ONE_WEEK,
                enableDnsQueryResolverLogs: true,
                enableFlowLogs: true,
            });
            this.vpc = vpc.vpc;
        }
        else if (properties.vpcId) {
            // Use an existing VPC
            this.vpc = aws_ec2_1.Vpc.fromLookup(this, 'vpc', {
                vpcId: properties.vpcId,
            });
            this.externalVpc = true;
        }
        else {
            throw new Error('Either createVpc or vpcId must be specified');
        }
        if (properties.createCloudTrail == true) {
            // Create CloudTrail trail
            new cloudtrail_1.WorkshopCloudTrail(this, 'cloudtrail', {
                name: 'workshop-trail',
                includeS3DataEvents: true,
                logRetentionDays: properties.defaultRetentionDays || aws_logs_1.RetentionDays.ONE_WEEK,
            });
        }
    }
}
exports.CoreStack = CoreStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29yZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvcmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7RUFHRTs7O0FBRUY7Ozs7Ozs7R0FPRztBQUVILDZDQUF1RDtBQUV2RCxrREFBK0M7QUFDL0MsaURBQWdEO0FBQ2hELG1EQUF3RDtBQUN4RCxtREFBcUQ7QUFDckQseURBQThEO0FBQzlELCtDQUErRTtBQUMvRSxxREFBd0Y7QUFDeEYsK0VBQWtFO0FBQ2xFLHlEQUE4RztBQTBCOUc7Ozs7O0dBS0c7QUFDSCxNQUFhLFNBQVUsU0FBUSxtQkFBSztJQUloQzs7Ozs7O09BTUc7SUFDSCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFVBQStCO1FBQ3JFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLFNBQVMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQzFELElBQUksVUFBVSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ2xCLHFCQUFTLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzVELENBQUM7SUFDTCxDQUFDO0NBQ0o7QUFuQkQsOEJBbUJDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxNQUFhLFNBQVUsU0FBUSxtQkFBSztJQU1oQzs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxVQUErQjtRQUNyRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUU3QiwwQkFBMEI7UUFDMUIsSUFBSSxzQkFBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLENBQUMsZUFBZSxDQUFDLENBQUM7UUFFdkUsNkJBQTZCO1FBQzdCLElBQUksNEJBQWlCLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBRWhGLHNEQUFzRDtRQUN0RCxJQUFJLHFDQUFZLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpELDJDQUEyQztRQUMzQyxJQUFJLHdDQUEyQixDQUFDLElBQUksRUFBRSw2QkFBNkIsRUFBRSxVQUFVLENBQUMsb0JBQW9CLENBQUMsQ0FBQztRQUV0RyxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVMsSUFBSSxVQUFVLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDaEQsMERBQTBEO1lBQzFELElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxDQUFDO1lBQ3pCLE1BQU0sR0FBRyxHQUFHLElBQUkseUJBQWUsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFO2dCQUN6QyxJQUFJLEVBQUUsVUFBVTtnQkFDaEIsU0FBUyxFQUFFLFVBQVUsQ0FBQyxPQUFPLElBQUksYUFBYTtnQkFDOUMsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLG9CQUFvQixJQUFJLHdCQUFhLENBQUMsUUFBUTtnQkFDM0UsMEJBQTBCLEVBQUUsSUFBSTtnQkFDaEMsY0FBYyxFQUFFLElBQUk7YUFDdkIsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDO1FBQ3ZCLENBQUM7YUFBTSxJQUFJLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUMxQixzQkFBc0I7WUFDdEIsSUFBSSxDQUFDLEdBQUcsR0FBRyxhQUFHLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7Z0JBQ25DLEtBQUssRUFBRSxVQUFVLENBQUMsS0FBSzthQUMxQixDQUFDLENBQUM7WUFDSCxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQztRQUM1QixDQUFDO2FBQU0sQ0FBQztZQUNKLE1BQU0sSUFBSSxLQUFLLENBQUMsNkNBQTZDLENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBRUQsSUFBSSxVQUFVLENBQUMsZ0JBQWdCLElBQUksSUFBSSxFQUFFLENBQUM7WUFDdEMsMEJBQTBCO1lBQzFCLElBQUksK0JBQWtCLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtnQkFDdkMsSUFBSSxFQUFFLGdCQUFnQjtnQkFDdEIsbUJBQW1CLEVBQUUsSUFBSTtnQkFDekIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLG9CQUFvQixJQUFJLHdCQUFhLENBQUMsUUFBUTthQUM5RSxDQUFDLENBQUM7UUFDUCxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBM0RELDhCQTJEQyIsInNvdXJjZXNDb250ZW50IjpbIi8qXG5Db3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cblNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG4qL1xuXG4vKipcbiAqIENvcmUgaW5mcmFzdHJ1Y3R1cmUgc3RhZ2UgYW5kIHN0YWNrIGZvciB0aGUgT25lIE9ic2VydmFiaWxpdHkgV29ya3Nob3AuXG4gKlxuICogVGhpcyBtb2R1bGUgZGVmaW5lcyB0aGUgY29yZSBpbmZyYXN0cnVjdHVyZSBjb21wb25lbnRzIGluY2x1ZGluZyBWUEMgc2V0dXAsXG4gKiBuZXR3b3JraW5nIGNvbmZpZ3VyYXRpb24sIGFuZCBmb3VuZGF0aW9uYWwgcmVzb3VyY2VzIG5lZWRlZCBmb3IgdGhlIHdvcmtzaG9wLlxuICpcbiAqIEBwYWNrYWdlRG9jdW1lbnRhdGlvblxuICovXG5cbmltcG9ydCB7IFN0YWNrLCBTdGFja1Byb3BzLCBTdGFnZSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgVXRpbGl0aWVzIH0gZnJvbSAnLi4vdXRpbHMvdXRpbGl0aWVzJztcbmltcG9ydCB7IElWcGMsIFZwYyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0IHsgV29ya3Nob3BOZXR3b3JrIH0gZnJvbSAnLi4vY29uc3RydWN0cy9uZXR3b3JrJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBXb3Jrc2hvcENsb3VkVHJhaWwgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL2Nsb3VkdHJhaWwnO1xuaW1wb3J0IHsgUXVldWVSZXNvdXJjZXMsIFF1ZXVlUmVzb3VyY2VzUHJvcGVydGllcyB9IGZyb20gJy4uL2NvbnN0cnVjdHMvcXVldWUnO1xuaW1wb3J0IHsgRXZlbnRCdXNSZXNvdXJjZXMsIEV2ZW50QnVzUmVzb3VyY2VzUHJvcGVydGllcyB9IGZyb20gJy4uL2NvbnN0cnVjdHMvZXZlbnRidXMnO1xuaW1wb3J0IHsgQ2ZuRGlzY292ZXJ5IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwcGxpY2F0aW9uc2lnbmFscyc7XG5pbXBvcnQgeyBDbG91ZFdhdGNoVHJhbnNhY3Rpb25TZWFyY2gsIENsb3VkV2F0Y2hUcmFuc2FjdGlvblNlYXJjaFByb3BlcnRpZXMgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL2Nsb3Vkd2F0Y2gnO1xuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gcHJvcGVydGllcyBmb3IgdGhlIENvcmVTdGFnZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlU3RhZ2VQcm9wZXJ0aWVzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gICAgLyoqIFRhZ3MgdG8gYXBwbHkgdG8gYWxsIHJlc291cmNlcyBpbiB0aGUgc3RhZ2UgKi9cbiAgICB0YWdzPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgICAvKiogV2hldGhlciB0byBjcmVhdGUgYSBuZXcgVlBDIChkZWZhdWx0OiB0cnVlKSAqL1xuICAgIGNyZWF0ZVZwYz86IGJvb2xlYW47XG4gICAgLyoqIENJRFIgcmFuZ2UgZm9yIHRoZSBWUEMgaWYgY3JlYXRpbmcgYSBuZXcgb25lICovXG4gICAgdnBjQ2lkcj86IHN0cmluZztcbiAgICAvKiogRXhpc3RpbmcgVlBDIElEIHRvIHVzZSBpbnN0ZWFkIG9mIGNyZWF0aW5nIG5ldyBvbmUgKi9cbiAgICB2cGNJZD86IHN0cmluZztcbiAgICAvKiogV2hldGhlciB0byBjcmVhdGUgYSBDbG91ZFRyYWlsIHRyYWlsIChkZWZhdWx0OiB0cnVlKSAqL1xuICAgIGNyZWF0ZUNsb3VkVHJhaWw/OiBib29sZWFuO1xuICAgIC8qKiBEZWZhdWx0IFJldGVudGlvbiBQZXJpb2QgZm9yIGxvZ3MgKi9cbiAgICBkZWZhdWx0UmV0ZW50aW9uRGF5cz86IFJldGVudGlvbkRheXM7XG4gICAgLyoqIFF1ZXVlIFJlc291cmNlcyAqL1xuICAgIHF1ZXVlUHJvcGVydGllcz86IFF1ZXVlUmVzb3VyY2VzUHJvcGVydGllcztcbiAgICAvKiogRXZlbnRCdXMgUmVzb3VyY2VzICovXG4gICAgZXZlbnRCdXNQcm9wZXJ0aWVzPzogRXZlbnRCdXNSZXNvdXJjZXNQcm9wZXJ0aWVzO1xuICAgIC8qKiBDbG91ZFdhdGNoIFJlc291cmNlcyAqL1xuICAgIGNsb3VkV2F0Y2hQcm9wZXJ0aWVzPzogQ2xvdWRXYXRjaFRyYW5zYWN0aW9uU2VhcmNoUHJvcGVydGllcztcbn1cblxuLyoqXG4gKiBDb3JlIGRlcGxveW1lbnQgc3RhZ2UgY29udGFpbmluZyB0aGUgZm91bmRhdGlvbmFsIGluZnJhc3RydWN0dXJlIHN0YWNrLlxuICpcbiAqIFRoaXMgc3RhZ2UgY3JlYXRlcyB0aGUgY29yZSBpbmZyYXN0cnVjdHVyZSBuZWVkZWQgZm9yIHRoZSBPbmUgT2JzZXJ2YWJpbGl0eVxuICogV29ya3Nob3AsIGluY2x1ZGluZyBuZXR3b3JraW5nIGNvbXBvbmVudHMgYW5kIGJhc2UgcmVzb3VyY2VzLlxuICovXG5leHBvcnQgY2xhc3MgQ29yZVN0YWdlIGV4dGVuZHMgU3RhZ2Uge1xuICAgIC8qKiBUaGUgY29yZSBpbmZyYXN0cnVjdHVyZSBzdGFjayAqL1xuICAgIHB1YmxpYyByZWFkb25seSBjb3JlU3RhY2s6IENvcmVTdGFjaztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgQ29yZVN0YWdlLlxuICAgICAqXG4gICAgICogQHBhcmFtIHNjb3BlIC0gVGhlIHBhcmVudCBjb25zdHJ1Y3RcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgc3RhZ2UgaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQ29uZmlndXJhdGlvbiBwcm9wZXJ0aWVzIGZvciB0aGUgc3RhZ2VcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBDb3JlU3RhZ2VQcm9wZXJ0aWVzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICAgICAgdGhpcy5jb3JlU3RhY2sgPSBuZXcgQ29yZVN0YWNrKHRoaXMsIGBTdGFja2AsIHByb3BlcnRpZXMpO1xuICAgICAgICBpZiAocHJvcGVydGllcy50YWdzKSB7XG4gICAgICAgICAgICBVdGlsaXRpZXMuVGFnQ29uc3RydWN0KHRoaXMuY29yZVN0YWNrLCBwcm9wZXJ0aWVzLnRhZ3MpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG4vKipcbiAqIENvcmUgaW5mcmFzdHJ1Y3R1cmUgc3RhY2sgY29udGFpbmluZyBWUEMgYW5kIG5ldHdvcmtpbmcgcmVzb3VyY2VzLlxuICpcbiAqIFRoaXMgc3RhY2sgc2V0cyB1cCB0aGUgZm91bmRhdGlvbmFsIG5ldHdvcmtpbmcgaW5mcmFzdHJ1Y3R1cmUgZm9yIHRoZSB3b3Jrc2hvcCxcbiAqIGVpdGhlciBieSBjcmVhdGluZyBhIG5ldyBWUEMgb3IgdXNpbmcgYW4gZXhpc3Rpbmcgb25lLlxuICovXG5leHBvcnQgY2xhc3MgQ29yZVN0YWNrIGV4dGVuZHMgU3RhY2sge1xuICAgIC8qKiBUaGUgVlBDIGluc3RhbmNlIHVzZWQgYnkgdGhlIHdvcmtzaG9wICovXG4gICAgcHVibGljIHJlYWRvbmx5IHZwYzogSVZwYztcbiAgICAvKiogV2hldGhlciB0aGUgVlBDIGlzIGV4dGVybmFsbHkgbWFuYWdlZCAobm90IGNyZWF0ZWQgYnkgdGhpcyBzdGFjaykgKi9cbiAgICBwdWJsaWMgcmVhZG9ubHkgZXh0ZXJuYWxWcGM6IGJvb2xlYW47XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IENvcmVTdGFjay5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBzY29wZSAtIFRoZSBwYXJlbnQgY29uc3RydWN0XG4gICAgICogQHBhcmFtIGlkIC0gVGhlIHN0YWNrIGlkZW50aWZpZXJcbiAgICAgKiBAcGFyYW0gcHJvcGVydGllcyAtIENvbmZpZ3VyYXRpb24gcHJvcGVydGllcyBmb3IgdGhlIHN0YWNrXG4gICAgICogQHRocm93cyBFcnJvciB3aGVuIG5laXRoZXIgY3JlYXRlVnBjIG5vciB2cGNJZCBpcyBwcm9wZXJseSBzcGVjaWZpZWRcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBDb3JlU3RhZ2VQcm9wZXJ0aWVzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcGVydGllcyk7XG5cbiAgICAgICAgLyoqIEFkZCBRdWV1ZSByZXNvdXJjZXMgKi9cbiAgICAgICAgbmV3IFF1ZXVlUmVzb3VyY2VzKHRoaXMsICdRdWV1ZVJlc291cmNlcycsIHByb3BlcnRpZXMucXVldWVQcm9wZXJ0aWVzKTtcblxuICAgICAgICAvKiogQWRkIEV2ZW50QnVzIHJlc291cmNlcyAqL1xuICAgICAgICBuZXcgRXZlbnRCdXNSZXNvdXJjZXModGhpcywgJ0V2ZW50QnVzUmVzb3VyY2VzJywgcHJvcGVydGllcy5ldmVudEJ1c1Byb3BlcnRpZXMpO1xuXG4gICAgICAgIC8qKiBFbmFibGUgQ2xvdWRXYXRjaCBBcHBsaWNhdGlvbiBTaWduYWxzIERpc2NvdmVyeSAqL1xuICAgICAgICBuZXcgQ2ZuRGlzY292ZXJ5KHRoaXMsICdBcHBsaWNhdGlvblNpZ25hbHMnLCB7fSk7XG5cbiAgICAgICAgLyoqIENsb3VkV2F0Y2ggVHJhbnNhY3Rpb24gU2VhcmNoIHNldHVwICoqL1xuICAgICAgICBuZXcgQ2xvdWRXYXRjaFRyYW5zYWN0aW9uU2VhcmNoKHRoaXMsICdDbG91ZFdhdGNoVHJhbnNhY3Rpb25TZWFyY2gnLCBwcm9wZXJ0aWVzLmNsb3VkV2F0Y2hQcm9wZXJ0aWVzKTtcblxuICAgICAgICBpZiAoIXByb3BlcnRpZXMuY3JlYXRlVnBjIHx8IHByb3BlcnRpZXMuY3JlYXRlVnBjKSB7XG4gICAgICAgICAgICAvLyBDcmVhdGUgYSBuZXcgVlBDIHdpdGggd29ya3Nob3AgbmV0d29ya2luZyBjb25maWd1cmF0aW9uXG4gICAgICAgICAgICB0aGlzLmV4dGVybmFsVnBjID0gZmFsc2U7XG4gICAgICAgICAgICBjb25zdCB2cGMgPSBuZXcgV29ya3Nob3BOZXR3b3JrKHRoaXMsICd2cGMnLCB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1dvcmtzaG9wJyxcbiAgICAgICAgICAgICAgICBjaWRyUmFuZ2U6IHByb3BlcnRpZXMudnBjQ2lkciB8fCAnMTAuMC4wLjAvMTYnLFxuICAgICAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IHByb3BlcnRpZXMuZGVmYXVsdFJldGVudGlvbkRheXMgfHwgUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgICAgICAgICBlbmFibGVEbnNRdWVyeVJlc29sdmVyTG9nczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBlbmFibGVGbG93TG9nczogdHJ1ZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy52cGMgPSB2cGMudnBjO1xuICAgICAgICB9IGVsc2UgaWYgKHByb3BlcnRpZXMudnBjSWQpIHtcbiAgICAgICAgICAgIC8vIFVzZSBhbiBleGlzdGluZyBWUENcbiAgICAgICAgICAgIHRoaXMudnBjID0gVnBjLmZyb21Mb29rdXAodGhpcywgJ3ZwYycsIHtcbiAgICAgICAgICAgICAgICB2cGNJZDogcHJvcGVydGllcy52cGNJZCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5leHRlcm5hbFZwYyA9IHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VpdGhlciBjcmVhdGVWcGMgb3IgdnBjSWQgbXVzdCBiZSBzcGVjaWZpZWQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwcm9wZXJ0aWVzLmNyZWF0ZUNsb3VkVHJhaWwgPT0gdHJ1ZSkge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIENsb3VkVHJhaWwgdHJhaWxcbiAgICAgICAgICAgIG5ldyBXb3Jrc2hvcENsb3VkVHJhaWwodGhpcywgJ2Nsb3VkdHJhaWwnLCB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ3dvcmtzaG9wLXRyYWlsJyxcbiAgICAgICAgICAgICAgICBpbmNsdWRlUzNEYXRhRXZlbnRzOiB0cnVlLFxuICAgICAgICAgICAgICAgIGxvZ1JldGVudGlvbkRheXM6IHByb3BlcnRpZXMuZGVmYXVsdFJldGVudGlvbkRheXMgfHwgUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxufVxuIl19