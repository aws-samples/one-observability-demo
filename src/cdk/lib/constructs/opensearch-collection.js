"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenSearchCollection = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_opensearchserverless_1 = require("aws-cdk-lib/aws-opensearchserverless");
const constructs_1 = require("constructs");
const constants_1 = require("../../bin/constants");
const utilities_1 = require("../utils/utilities");
const environment_1 = require("../../bin/environment");
/**
 * AWS CDK Construct that creates OpenSearch Serverless collection with CloudWatch alarms for pet adoption
 * @class OpenSearchCollection
 * @extends Construct
 */
class OpenSearchCollection extends constructs_1.Construct {
    /**
     * Creates a new OpenSearchCollection construct with collection
     * @param scope - The parent construct
     * @param id - The construct ID
     * @param properties - Configuration properties for the construct (optional)
     */
    constructor(scope, id, properties) {
        super(scope, id);
        const collectionName = properties?.collectionName || 'pet-collection';
        const description = properties?.description || 'Pet adoption data collection';
        const type = properties?.type || 'TIMESERIES';
        // Create security policy for encryption
        this.securityPolicy = new aws_opensearchserverless_1.CfnSecurityPolicy(this, 'SecurityPolicy', {
            name: `${collectionName}-sec-policy`,
            type: 'encryption',
            policy: JSON.stringify({
                Rules: [
                    {
                        ResourceType: 'collection',
                        Resource: [`collection/${collectionName}`],
                    },
                ],
                AWSOwnedKey: true,
            }),
        });
        // Create network security policy
        const networkSecurityPolicy = new aws_opensearchserverless_1.CfnSecurityPolicy(this, 'NetworkSecurityPolicy', {
            name: `${collectionName}-net-policy`,
            type: 'network',
            policy: JSON.stringify([
                {
                    Rules: [
                        {
                            ResourceType: 'collection',
                            Resource: [`collection/${collectionName}`],
                        },
                        {
                            ResourceType: 'dashboard',
                            Resource: [`collection/${collectionName}`],
                        },
                    ],
                    AllowFromPublic: true,
                },
            ]),
        });
        // Create the OpenSearch Serverless collection
        this.collection = new aws_opensearchserverless_1.CfnCollection(this, 'Collection', {
            name: collectionName,
            description: description,
            type: type,
        });
        // Add dependencies
        this.collection.addDependency(this.securityPolicy);
        this.collection.addDependency(networkSecurityPolicy);
        // Get the AWS account ID from the stack
        const accountId = aws_cdk_lib_1.Stack.of(this).account;
        // Allow all principals in the account to access the collection.
        const principals = [`arn:aws:iam::${accountId}:root`];
        // Create access policy for the collection
        this.accessPolicy = new aws_opensearchserverless_1.CfnAccessPolicy(this, 'AccessPolicy', {
            name: `${collectionName}-acc-policy`,
            type: 'data',
            policy: JSON.stringify([
                {
                    Rules: [
                        {
                            ResourceType: 'collection',
                            Resource: [`collection/${collectionName}`],
                            Permission: [
                                'aoss:CreateCollectionItems',
                                'aoss:DeleteCollectionItems',
                                'aoss:UpdateCollectionItems',
                                'aoss:DescribeCollectionItems',
                            ],
                        },
                        {
                            ResourceType: 'index',
                            Resource: [`index/${collectionName}/*`],
                            Permission: [
                                'aoss:CreateIndex',
                                'aoss:DeleteIndex',
                                'aoss:UpdateIndex',
                                'aoss:DescribeIndex',
                                'aoss:ReadDocument',
                                'aoss:WriteDocument',
                            ],
                        },
                    ],
                    Principal: principals,
                },
            ]),
        });
        // Add dependency for access policy
        this.accessPolicy.addDependency(this.collection);
        this.createExports();
        this.createOutputs();
    }
    createExports() {
        new aws_cdk_lib_1.CfnOutput(this, 'CollectionArn', {
            value: this.collection.attrArn,
            exportName: constants_1.OPENSEARCH_COLLECTION_ARN_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'CollectionId', {
            value: this.collection.attrId,
            exportName: constants_1.OPENSEARCH_COLLECTION_ID_EXPORT_NAME,
        });
        new aws_cdk_lib_1.CfnOutput(this, 'CollectionEndpoint', {
            value: this.collection.attrCollectionEndpoint,
            exportName: constants_1.OPENSEARCH_COLLECTION_ENDPOINT_EXPORT_NAME,
        });
        // Export access policy name for updates
        new aws_cdk_lib_1.CfnOutput(this, 'AccessPolicyName', {
            value: this.accessPolicy.name,
            exportName: `${constants_1.OPENSEARCH_COLLECTION_ARN_EXPORT_NAME}-AccessPolicy`,
        });
    }
    static importFromExports() {
        const collectionArn = aws_cdk_lib_1.Fn.importValue(constants_1.OPENSEARCH_COLLECTION_ARN_EXPORT_NAME);
        const collectionId = aws_cdk_lib_1.Fn.importValue(constants_1.OPENSEARCH_COLLECTION_ID_EXPORT_NAME);
        const collectionEndpoint = aws_cdk_lib_1.Fn.importValue(constants_1.OPENSEARCH_COLLECTION_ENDPOINT_EXPORT_NAME);
        return {
            collectionArn,
            collectionId,
            collectionEndpoint,
        };
    }
    /**
     * Add additional ingestion roles to the access policy
     * @param roles - Array of IAM roles to grant access
     */
    addIngestionRoles(roles) {
        const accountId = aws_cdk_lib_1.Stack.of(this).account;
        const collectionName = this.collection.name;
        // Get current principals
        const currentPolicy = JSON.parse(this.accessPolicy.policy);
        const currentPrincipals = currentPolicy[0].Principal || [];
        // Add new role ARNs
        roles.forEach(role => {
            if (!currentPrincipals.includes(role.roleArn)) {
                currentPrincipals.push(role.roleArn);
            }
        });
        // Update the access policy
        this.accessPolicy.policy = JSON.stringify([
            {
                Rules: [
                    {
                        ResourceType: 'collection',
                        Resource: [`collection/${collectionName}`],
                        Permission: [
                            'aoss:CreateCollectionItems',
                            'aoss:DeleteCollectionItems',
                            'aoss:UpdateCollectionItems',
                            'aoss:DescribeCollectionItems',
                        ],
                    },
                    {
                        ResourceType: 'index',
                        Resource: [`index/${collectionName}/*`],
                        Permission: [
                            'aoss:CreateIndex',
                            'aoss:DeleteIndex',
                            'aoss:UpdateIndex',
                            'aoss:DescribeIndex',
                            'aoss:ReadDocument',
                            'aoss:WriteDocument',
                        ],
                    },
                ],
                Principal: currentPrincipals,
            },
        ]);
    }
    createOutputs() {
        if (this.collection) {
            utilities_1.Utilities.createSsmParameters(this, environment_1.PARAMETER_STORE_PREFIX, new Map(Object.entries({
                opensearchcollectionarn: this.collection.attrArn,
                opensearchcollectionid: this.collection.attrId,
                opensearchcollectionendpoint: this.collection.attrCollectionEndpoint,
            })));
        }
        else {
            throw new Error('OpenSearch collection is not available');
        }
    }
}
exports.OpenSearchCollection = OpenSearchCollection;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlbnNlYXJjaC1jb2xsZWN0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsib3BlbnNlYXJjaC1jb2xsZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBOzs7RUFHRTtBQUNGLDZDQUFtRDtBQUNuRCxtRkFBeUc7QUFFekcsMkNBQXVDO0FBQ3ZDLG1EQUk2QjtBQUM3QixrREFBK0M7QUFDL0MsdURBQStEO0FBNkIvRDs7OztHQUlHO0FBQ0gsTUFBYSxvQkFBcUIsU0FBUSxzQkFBUztJQW1CL0M7Ozs7O09BS0c7SUFDSCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFVBQTJDO1FBQ2pGLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsTUFBTSxjQUFjLEdBQUcsVUFBVSxFQUFFLGNBQWMsSUFBSSxnQkFBZ0IsQ0FBQztRQUN0RSxNQUFNLFdBQVcsR0FBRyxVQUFVLEVBQUUsV0FBVyxJQUFJLDhCQUE4QixDQUFDO1FBQzlFLE1BQU0sSUFBSSxHQUFHLFVBQVUsRUFBRSxJQUFJLElBQUksWUFBWSxDQUFDO1FBRTlDLHdDQUF3QztRQUN4QyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksNENBQWlCLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ2hFLElBQUksRUFBRSxHQUFHLGNBQWMsYUFBYTtZQUNwQyxJQUFJLEVBQUUsWUFBWTtZQUNsQixNQUFNLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsS0FBSyxFQUFFO29CQUNIO3dCQUNJLFlBQVksRUFBRSxZQUFZO3dCQUMxQixRQUFRLEVBQUUsQ0FBQyxjQUFjLGNBQWMsRUFBRSxDQUFDO3FCQUM3QztpQkFDSjtnQkFDRCxXQUFXLEVBQUUsSUFBSTthQUNwQixDQUFDO1NBQ0wsQ0FBQyxDQUFDO1FBRUgsaUNBQWlDO1FBQ2pDLE1BQU0scUJBQXFCLEdBQUcsSUFBSSw0Q0FBaUIsQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFD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SyxDQUFDLHdDQUF3QyxDQUFDLENBQUM7UUFDOUQsQ0FBQztJQUNMLENBQUM7Q0FDSjtBQTFPRCxvREEwT0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuQ29weXJpZ2h0IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG5TUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogQXBhY2hlLTIuMFxuKi9cbmltcG9ydCB7IENmbk91dHB1dCwgRm4sIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ2ZuQ29sbGVjdGlvbiwgQ2ZuU2VjdXJpdHlQb2xpY3ksIENmbkFjY2Vzc1BvbGljeSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1vcGVuc2VhcmNoc2VydmVybGVzcyc7XG5pbXBvcnQgeyBJUm9sZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQge1xuICAgIE9QRU5TRUFSQ0hfQ09MTEVDVElPTl9BUk5fRVhQT1JUX05BTUUsXG4gICAgT1BFTlNFQVJDSF9DT0xMRUNUSU9OX0lEX0VYUE9SVF9OQU1FLFxuICAgIE9QRU5TRUFSQ0hfQ09MTEVDVElPTl9FTkRQT0lOVF9FWFBPUlRfTkFNRSxcbn0gZnJvbSAnLi4vLi4vYmluL2NvbnN0YW50cyc7XG5pbXBvcnQgeyBVdGlsaXRpZXMgfSBmcm9tICcuLi91dGlscy91dGlsaXRpZXMnO1xuaW1wb3J0IHsgUEFSQU1FVEVSX1NUT1JFX1BSRUZJWCB9IGZyb20gJy4uLy4uL2Jpbi9lbnZpcm9ubWVudCc7XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgY29uZmlndXJpbmcgT3BlblNlYXJjaENvbGxlY3Rpb24gY29uc3RydWN0XG4gKiBAaW50ZXJmYWNlIE9wZW5TZWFyY2hDb2xsZWN0aW9uUHJvcGVydGllc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIE9wZW5TZWFyY2hDb2xsZWN0aW9uUHJvcGVydGllcyB7XG4gICAgLyoqXG4gICAgICogTmFtZSBvZiB0aGUgT3BlblNlYXJjaCBTZXJ2ZXJsZXNzIGNvbGxlY3Rpb25cbiAgICAgKiBAZGVmYXVsdCAncGV0YWRvcHRpb24tY29sbGVjdGlvbidcbiAgICAgKi9cbiAgICBjb2xsZWN0aW9uTmFtZT86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBEZXNjcmlwdGlvbiBmb3IgdGhlIE9wZW5TZWFyY2ggU2VydmVybGVzcyBjb2xsZWN0aW9uXG4gICAgICogQGRlZmF1bHQgJ1BldCBhZG9wdGlvbiBkYXRhIGNvbGxlY3Rpb24nXG4gICAgICovXG4gICAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogVHlwZSBvZiB0aGUgT3BlblNlYXJjaCBTZXJ2ZXJsZXNzIGNvbGxlY3Rpb25cbiAgICAgKiBAZGVmYXVsdCAnVElNRVNFUklFUydcbiAgICAgKi9cbiAgICB0eXBlPzogJ1NFQVJDSCcgfCAnVElNRVNFUklFUycgfCAnVkVDVE9SU0VBUkNIJztcbiAgICAvKipcbiAgICAgKiBSb2xlcyB0aGF0IG5lZWQgYWNjZXNzIHRvIGluZ2VzdCBkYXRhIGludG8gdGhlIE9wZW5TZWFyY2ggY29sbGVjdGlvblxuICAgICAqIEBvcHRpb25hbFxuICAgICAqL1xuICAgIGluZ2VzdGlvblJvbGVzPzogSVJvbGVbXTtcbn1cblxuLyoqXG4gKiBBV1MgQ0RLIENvbnN0cnVjdCB0aGF0IGNyZWF0ZXMgT3BlblNlYXJjaCBTZXJ2ZXJsZXNzIGNvbGxlY3Rpb24gd2l0aCBDbG91ZFdhdGNoIGFsYXJtcyBmb3IgcGV0IGFkb3B0aW9uXG4gKiBAY2xhc3MgT3BlblNlYXJjaENvbGxlY3Rpb25cbiAqIEBleHRlbmRzIENvbnN0cnVjdFxuICovXG5leHBvcnQgY2xhc3MgT3BlblNlYXJjaENvbGxlY3Rpb24gZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICAgIC8qKlxuICAgICAqIFRoZSBPcGVuU2VhcmNoIFNlcnZlcmxlc3MgY29sbGVjdGlvbiBmb3Igc3RvcmluZyBwZXQgYWRvcHRpb24gZGF0YVxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBwdWJsaWMgY29sbGVjdGlvbjogQ2ZuQ29sbGVjdGlvbjtcblxuICAgIC8qKlxuICAgICAqIFRoZSBzZWN1cml0eSBwb2xpY3kgZm9yIHRoZSBjb2xsZWN0aW9uXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIHB1YmxpYyBzZWN1cml0eVBvbGljeTogQ2ZuU2VjdXJpdHlQb2xpY3k7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgYWNjZXNzIHBvbGljeSBmb3IgdGhlIGNvbGxlY3Rpb25cbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgcHVibGljIGFjY2Vzc1BvbGljeTogQ2ZuQWNjZXNzUG9saWN5O1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBPcGVuU2VhcmNoQ29sbGVjdGlvbiBjb25zdHJ1Y3Qgd2l0aCBjb2xsZWN0aW9uXG4gICAgICogQHBhcmFtIHNjb3BlIC0gVGhlIHBhcmVudCBjb25zdHJ1Y3RcbiAgICAgKiBAcGFyYW0gaWQgLSBUaGUgY29uc3RydWN0IElEXG4gICAgICogQHBhcmFtIHByb3BlcnRpZXMgLSBDb25maWd1cmF0aW9uIHByb3BlcnRpZXMgZm9yIHRoZSBjb25zdHJ1Y3QgKG9wdGlvbmFsKVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BlcnRpZXM/OiBPcGVuU2VhcmNoQ29sbGVjdGlvblByb3BlcnRpZXMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgICAgICBjb25zdCBjb2xsZWN0aW9uTmFtZSA9IHByb3BlcnRpZXM/LmNvbGxlY3Rpb25OYW1lIHx8ICdwZXQtY29sbGVjdGlvbic7XG4gICAgICAgIGNvbnN0IGRlc2NyaXB0aW9uID0gcHJvcGVydGllcz8uZGVzY3JpcHRpb24gfHwgJ1BldCBhZG9wdGlvbiBkYXRhIGNvbGxlY3Rpb24nO1xuICAgICAgICBjb25zdCB0eXBlID0gcHJvcGVydGllcz8udHlwZSB8fCAnVElNRVNFUklFUyc7XG5cbiAgICAgICAgLy8gQ3JlYXRlIHNlY3VyaXR5IHBvbGljeSBmb3IgZW5jcnlwdGlvblxuICAgICAgICB0aGlzLnNlY3VyaXR5UG9saWN5ID0gbmV3IENmblNlY3VyaXR5UG9saWN5KHRoaXMsICdTZWN1cml0eVBvbGljeScsIHtcbiAgICAgICAgICAgIG5hbWU6IGAke2NvbGxlY3Rpb25OYW1lfS1zZWMtcG9saWN5YCxcbiAgICAgICAgICAgIHR5cGU6ICdlbmNyeXB0aW9uJyxcbiAgICAgICAgICAgIHBvbGljeTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIFJ1bGVzOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIFJlc291cmNlVHlwZTogJ2NvbGxlY3Rpb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgUmVzb3VyY2U6IFtgY29sbGVjdGlvbi8ke2NvbGxlY3Rpb25OYW1lfWBdLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgQVdTT3duZWRLZXk6IHRydWUsXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIG5ldHdvcmsgc2VjdXJpdHkgcG9saWN5XG4gICAgICAgIGNvbnN0IG5ldHdvcmtTZWN1cml0eVBvbGljeSA9IG5ldyBDZm5TZWN1cml0eVBvbGljeSh0aGlzLCAnTmV0d29ya1NlY3VyaXR5UG9saWN5Jywge1xuICAgICAgICAgICAgbmFtZTogYCR7Y29sbGVjdGlvbk5hbWV9LW5ldC1wb2xpY3lgLFxuICAgICAgICAgICAgdHlwZTogJ25ldHdvcmsnLFxuICAgICAgICAgICAgcG9saWN5OiBKU09OLnN0cmluZ2lmeShbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBSdWxlczogW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlc291cmNlVHlwZTogJ2NvbGxlY3Rpb24nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlc291cmNlOiBbYGNvbGxlY3Rpb24vJHtjb2xsZWN0aW9uTmFtZX1gXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUmVzb3VyY2VUeXBlOiAnZGFzaGJvYXJkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBSZXNvdXJjZTogW2Bjb2xsZWN0aW9uLyR7Y29sbGVjdGlvbk5hbWV9YF0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICBBbGxvd0Zyb21QdWJsaWM6IHRydWUsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0pLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBDcmVhdGUgdGhlIE9wZW5TZWFyY2ggU2VydmVybGVzcyBjb2xsZWN0aW9uXG4gICAgICAgIHRoaXMuY29sbGVjdGlvbiA9IG5ldyBDZm5Db2xsZWN0aW9uKHRoaXMsICdDb2xsZWN0aW9uJywge1xuICAgICAgICAgICAgbmFtZTogY29sbGVjdGlvbk5hbWUsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogZGVzY3JpcHRpb24sXG4gICAgICAgICAgICB0eXBlOiB0eXBlLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgZGVwZW5kZW5jaWVzXG4gICAgICAgIHRoaXMuY29sbGVjdGlvbi5hZGREZXBlbmRlbmN5KHRoaXMuc2VjdXJpdHlQb2xpY3kpO1xuICAgICAgICB0aGlzLmNvbGxlY3Rpb24uYWRkRGVwZW5kZW5jeShuZXR3b3JrU2VjdXJpdHlQb2xpY3kpO1xuXG4gICAgICAgIC8vIEdldCB0aGUgQVdTIGFjY291bnQgSUQgZnJvbSB0aGUgc3RhY2tcbiAgICAgICAgY29uc3QgYWNjb3VudElkID0gU3RhY2sub2YodGhpcykuYWNjb3VudDtcblxuICAgICAgICAvLyBBbGxvdyBhbGwgcHJpbmNpcGFscyBpbiB0aGUgYWNjb3VudCB0byBhY2Nlc3MgdGhlIGNvbGxlY3Rpb24uXG4gICAgICAgIGNvbnN0IHByaW5jaXBhbHM6IHN0cmluZ1tdID0gW2Bhcm46YXdzOmlhbTo6JHthY2NvdW50SWR9OnJvb3RgXTtcblxuICAgICAgICAvLyBDcmVhdGUgYWNjZXNzIHBvbGljeSBmb3IgdGhlIGNvbGxlY3Rpb25cbiAgICAgICAgdGhpcy5hY2Nlc3NQb2xpY3kgPSBuZXcgQ2ZuQWNjZXNzUG9saWN5KHRoaXMsICdBY2Nlc3NQb2xpY3knLCB7XG4gICAgICAgICAgICBuYW1lOiBgJHtjb2xsZWN0aW9uTmFtZX0tYWNjLXBvbGljeWAsXG4gICAgICAgICAgICB0eXBlOiAnZGF0YScsXG4gICAgICAgICAgICBwb2xpY3k6IEpTT04uc3RyaW5naWZ5KFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIFJ1bGVzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUmVzb3VyY2VUeXBlOiAnY29sbGVjdGlvbicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUmVzb3VyY2U6IFtgY29sbGVjdGlvbi8ke2NvbGxlY3Rpb25OYW1lfWBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFBlcm1pc3Npb246IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6Q3JlYXRlQ29sbGVjdGlvbkl0ZW1zJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6RGVsZXRlQ29sbGVjdGlvbkl0ZW1zJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6VXBkYXRlQ29sbGVjdGlvbkl0ZW1zJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6RGVzY3JpYmVDb2xsZWN0aW9uSXRlbXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlc291cmNlVHlwZTogJ2luZGV4JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBSZXNvdXJjZTogW2BpbmRleC8ke2NvbGxlY3Rpb25OYW1lfS8qYF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUGVybWlzc2lvbjogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYW9zczpDcmVhdGVJbmRleCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdhb3NzOkRlbGV0ZUluZGV4JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6VXBkYXRlSW5kZXgnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYW9zczpEZXNjcmliZUluZGV4JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6UmVhZERvY3VtZW50JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6V3JpdGVEb2N1bWVudCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgIFByaW5jaXBhbDogcHJpbmNpcGFscyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBkZXBlbmRlbmN5IGZvciBhY2Nlc3MgcG9saWN5XG4gICAgICAgIHRoaXMuYWNjZXNzUG9saWN5LmFkZERlcGVuZGVuY3kodGhpcy5jb2xsZWN0aW9uKTtcblxuICAgICAgICB0aGlzLmNyZWF0ZUV4cG9ydHMoKTtcbiAgICAgICAgdGhpcy5jcmVhdGVPdXRwdXRzKCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjcmVhdGVFeHBvcnRzKCk6IHZvaWQge1xuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdDb2xsZWN0aW9uQXJuJywge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMuY29sbGVjdGlvbi5hdHRyQXJuLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogT1BFTlNFQVJDSF9DT0xMRUNUSU9OX0FSTl9FWFBPUlRfTkFNRSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgbmV3IENmbk91dHB1dCh0aGlzLCAnQ29sbGVjdGlvbklkJywge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMuY29sbGVjdGlvbi5hdHRySWQsXG4gICAgICAgICAgICBleHBvcnROYW1lOiBPUEVOU0VBUkNIX0NPTExFQ1RJT05fSURfRVhQT1JUX05BTUUsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIG5ldyBDZm5PdXRwdXQodGhpcywgJ0NvbGxlY3Rpb25FbmRwb2ludCcsIHtcbiAgICAgICAgICAgIHZhbHVlOiB0aGlzLmNvbGxlY3Rpb24uYXR0ckNvbGxlY3Rpb25FbmRwb2ludCxcbiAgICAgICAgICAgIGV4cG9ydE5hbWU6IE9QRU5TRUFSQ0hfQ09MTEVDVElPTl9FTkRQT0lOVF9FWFBPUlRfTkFNRSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gRXhwb3J0IGFjY2VzcyBwb2xpY3kgbmFtZSBmb3IgdXBkYXRlc1xuICAgICAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdBY2Nlc3NQb2xpY3lOYW1lJywge1xuICAgICAgICAgICAgdmFsdWU6IHRoaXMuYWNjZXNzUG9saWN5Lm5hbWUhLFxuICAgICAgICAgICAgZXhwb3J0TmFtZTogYCR7T1BFTlNFQVJDSF9DT0xMRUNUSU9OX0FSTl9FWFBPUlRfTkFNRX0tQWNjZXNzUG9saWN5YCxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHVibGljIHN0YXRpYyBpbXBvcnRGcm9tRXhwb3J0cygpOiB7XG4gICAgICAgIGNvbGxlY3Rpb25Bcm46IHN0cmluZztcbiAgICAgICAgY29sbGVjdGlvbklkOiBzdHJpbmc7XG4gICAgICAgIGNvbGxlY3Rpb25FbmRwb2ludDogc3RyaW5nO1xuICAgIH0ge1xuICAgICAgICBjb25zdCBjb2xsZWN0aW9uQXJuID0gRm4uaW1wb3J0VmFsdWUoT1BFTlNFQVJDSF9DT0xMRUNUSU9OX0FSTl9FWFBPUlRfTkFNRSk7XG4gICAgICAgIGNvbnN0IGNvbGxlY3Rpb25JZCA9IEZuLmltcG9ydFZhbHVlKE9QRU5TRUFSQ0hfQ09MTEVDVElPTl9JRF9FWFBPUlRfTkFNRSk7XG4gICAgICAgIGNvbnN0IGNvbGxlY3Rpb25FbmRwb2ludCA9IEZuLmltcG9ydFZhbHVlKE9QRU5TRUFSQ0hfQ09MTEVDVElPTl9FTkRQT0lOVF9FWFBPUlRfTkFNRSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNvbGxlY3Rpb25Bcm4sXG4gICAgICAgICAgICBjb2xsZWN0aW9uSWQsXG4gICAgICAgICAgICBjb2xsZWN0aW9uRW5kcG9pbnQsXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQWRkIGFkZGl0aW9uYWwgaW5nZXN0aW9uIHJvbGVzIHRvIHRoZSBhY2Nlc3MgcG9saWN5XG4gICAgICogQHBhcmFtIHJvbGVzIC0gQXJyYXkgb2YgSUFNIHJvbGVzIHRvIGdyYW50IGFjY2Vzc1xuICAgICAqL1xuICAgIHB1YmxpYyBhZGRJbmdlc3Rpb25Sb2xlcyhyb2xlczogSVJvbGVbXSk6IHZvaWQge1xuICAgICAgICBjb25zdCBhY2NvdW50SWQgPSBTdGFjay5vZih0aGlzKS5hY2NvdW50O1xuICAgICAgICBjb25zdCBjb2xsZWN0aW9uTmFtZSA9IHRoaXMuY29sbGVjdGlvbi5uYW1lO1xuICAgICAgICBcbiAgICAgICAgLy8gR2V0IGN1cnJlbnQgcHJpbmNpcGFsc1xuICAgICAgICBjb25zdCBjdXJyZW50UG9saWN5ID0gSlNPTi5wYXJzZSh0aGlzLmFjY2Vzc1BvbGljeS5wb2xpY3kgYXMgc3RyaW5nKTtcbiAgICAgICAgY29uc3QgY3VycmVudFByaW5jaXBhbHMgPSBjdXJyZW50UG9saWN5WzBdLlByaW5jaXBhbCB8fCBbXTtcbiAgICAgICAgXG4gICAgICAgIC8vIEFkZCBuZXcgcm9sZSBBUk5zXG4gICAgICAgIHJvbGVzLmZvckVhY2gocm9sZSA9PiB7XG4gICAgICAgICAgICBpZiAoIWN1cnJlbnRQcmluY2lwYWxzLmluY2x1ZGVzKHJvbGUucm9sZUFybikpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50UHJpbmNpcGFscy5wdXNoKHJvbGUucm9sZUFybik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgLy8gVXBkYXRlIHRoZSBhY2Nlc3MgcG9saWN5XG4gICAgICAgIHRoaXMuYWNjZXNzUG9saWN5LnBvbGljeSA9IEpTT04uc3RyaW5naWZ5KFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBSdWxlczogW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdjb2xsZWN0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIFJlc291cmNlOiBbYGNvbGxlY3Rpb24vJHtjb2xsZWN0aW9uTmFtZX1gXSxcbiAgICAgICAgICAgICAgICAgICAgICAgIFBlcm1pc3Npb246IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYW9zczpDcmVhdGVDb2xsZWN0aW9uSXRlbXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdhb3NzOkRlbGV0ZUNvbGxlY3Rpb25JdGVtcycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6VXBkYXRlQ29sbGVjdGlvbkl0ZW1zJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYW9zczpEZXNjcmliZUNvbGxlY3Rpb25JdGVtcycsXG4gICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdpbmRleCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBSZXNvdXJjZTogW2BpbmRleC8ke2NvbGxlY3Rpb25OYW1lfS8qYF0sXG4gICAgICAgICAgICAgICAgICAgICAgICBQZXJtaXNzaW9uOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6Q3JlYXRlSW5kZXgnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICdhb3NzOkRlbGV0ZUluZGV4JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYW9zczpVcGRhdGVJbmRleCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6RGVzY3JpYmVJbmRleCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgJ2Fvc3M6UmVhZERvY3VtZW50JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnYW9zczpXcml0ZURvY3VtZW50JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBQcmluY2lwYWw6IGN1cnJlbnRQcmluY2lwYWxzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgXSk7XG4gICAgfVxuXG4gICAgY3JlYXRlT3V0cHV0cygpOiB2b2lkIHtcbiAgICAgICAgaWYgKHRoaXMuY29sbGVjdGlvbikge1xuICAgICAgICAgICAgVXRpbGl0aWVzLmNyZWF0ZVNzbVBhcmFtZXRlcnMoXG4gICAgICAgICAgICAgICAgdGhpcyxcbiAgICAgICAgICAgICAgICBQQVJBTUVURVJfU1RPUkVfUFJFRklYLFxuICAgICAgICAgICAgICAgIG5ldyBNYXAoXG4gICAgICAgICAgICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5zZWFyY2hjb2xsZWN0aW9uYXJuOiB0aGlzLmNvbGxlY3Rpb24uYXR0ckFybixcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5zZWFyY2hjb2xsZWN0aW9uaWQ6IHRoaXMuY29sbGVjdGlvbi5hdHRySWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGVuc2VhcmNoY29sbGVjdGlvbmVuZHBvaW50OiB0aGlzLmNvbGxlY3Rpb24uYXR0ckNvbGxlY3Rpb25FbmRwb2ludCxcbiAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ09wZW5TZWFyY2ggY29sbGVjdGlvbiBpcyBub3QgYXZhaWxhYmxlJyk7XG4gICAgICAgIH1cbiAgICB9XG59XG4iXX0=