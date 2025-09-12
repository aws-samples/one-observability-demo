/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Construct } from 'constructs';
import { EKSDeployment, EKSDeploymentProperties } from '../constructs/eks-deployment';
import { Microservice, MicroserviceProperties } from '../constructs/microservice';
import { readFileSync } from 'node:fs';
import * as yaml from 'yaml';
import * as nunjucks from 'nunjucks';
import { ManagedPolicy, Policy, PolicyDocument, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnPodIdentityAssociation } from 'aws-cdk-lib/aws-eks';
import {
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ApplicationTargetGroup,
    TargetType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {
    AllowedMethods,
    CachePolicy,
    Distribution,
    OriginProtocolPolicy,
    OriginRequestPolicy,
    SecurityPolicyProtocol,
    ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { Peer, Port, PrefixList } from 'aws-cdk-lib/aws-ec2';
import { Bucket, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

export class PetSite extends EKSDeployment {
    public readonly loadBalancer: ApplicationLoadBalancer;
    public readonly targetGroup: ApplicationTargetGroup;
    public readonly distribution: Distribution;
    constructor(scope: Construct, id: string, properties: EKSDeploymentProperties) {
        super(scope, id, properties);
        this.loadBalancer = new ApplicationLoadBalancer(scope, 'loadBalancer', {
            vpc: properties.vpc!,
            internetFacing: true,
            loadBalancerName: `LB-${properties.name}`,
            vpcSubnets: {
                subnets: properties.vpc!.publicSubnets,
            },
        });

        const cloudFrontPrefixList = PrefixList.fromLookup(this, 'cloudfront-prefix-list', {
            prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
        });
        // Allow CloudFront to access the load balancer
        this.loadBalancer.connections.allowFrom(
            Peer.prefixList(cloudFrontPrefixList.prefixListId),
            Port.tcp(80),
            'Allow CloudFront access',
        );

        this.targetGroup = new ApplicationTargetGroup(scope, 'targetGroup', {
            port: properties.listenerPort || 80,
            vpc: properties.vpc!,
            protocol: ApplicationProtocol.HTTP,
            targetGroupName: `TG-${properties.name}`,
            targetType: TargetType.IP,
            healthCheck: {
                path: properties.healthCheck,
            },
        });

        this.loadBalancer.addListener('listener', {
            port: properties.listenerPort || 80,
            protocol: ApplicationProtocol.HTTP,
            defaultTargetGroups: [this.targetGroup],
            open: false,
        });

        // TODO: Autodelete is not working for this bucket
        const cloudfrontAccessBucket = new Bucket(this, 'CloudfrontAccessLogs', {
            removalPolicy: RemovalPolicy.DESTROY,
            enforceSSL: true,
            objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED,
            autoDeleteObjects: true,
        });

        this.distribution = new Distribution(this, 'Distribution', {
            defaultBehavior: {
                origin: new LoadBalancerV2Origin(this.loadBalancer, {
                    protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
                }),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
                cachePolicy: CachePolicy.CACHING_DISABLED,
                allowedMethods: AllowedMethods.ALLOW_ALL,
            },
            comment: 'Petstore page',
            enableLogging: true,
            logBucket: cloudfrontAccessBucket,
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            errorResponses: [
                {
                    httpStatus: 404,
                    ttl: Duration.minutes(5),
                },
                {
                    httpStatus: 403,
                    ttl: Duration.minutes(5),
                },
            ],
            enableIpv6: false,
        });

        // Allow load balancer to reach EKS nodes
        this.loadBalancer.connections.allowTo(
            properties.eksCluster!.clusterSecurityGroup,
            Port.tcp(properties.listenerPort || 80),
            'Allow Load Balancer to EKS nodes',
        );

        this.namespace = 'petsite';
        this.serviceAccountName = 'petsite-sa';
        this.prepareManifest(properties);
        this.manifest = this.configureEKSService(properties);
        this.addPermissions(properties);
        this.manifest.node.addDependency(this.loadBalancer);

        this.createOutputs();

        NagSuppressions.addResourceSuppressions(
            this.loadBalancer,
            [
                {
                    id: 'AwsSolutions-ELB2',
                    reason: 'Access logs not required for this workshop',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            this.loadBalancer,
            [
                {
                    id: 'AwsSolutions-EC23',
                    reason: 'Public Load balancer requires access from anywhere',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            cloudfrontAccessBucket,
            [
                {
                    id: 'AwsSolutions-S1',
                    reason: 'Cloudfront access log bucket',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            this.distribution,
            [
                {
                    id: 'AwsSolutions-CFR4',
                    reason: 'Using default Cloudfront certificate in the workshop is acceptable',
                },
                {
                    id: 'AwsSolutions-CFR5',
                    reason: 'Using default Cloudfront certificate in the workshop is acceptable',
                },
            ],
            true,
        );

        Utilities.TagConstruct(this, {
            'app:owner': 'petstore',
            'app:project': 'workshop',
            'app:name': properties.name,
            'app:computType': properties.computeType,
            'app:hostType:': properties.hostType,
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- this is how KubnernetesManifests defines it
    prepareManifest(properties: EKSDeploymentProperties): Record<string, any>[] {
        if (!properties.manifestPath) {
            throw new Error('manifestPath is required');
        }

        const manifestTemplate = readFileSync(properties.manifestPath, 'utf8');
        nunjucks.configure({ autoescape: true });

        const deploymentYaml = nunjucks.renderString(manifestTemplate, {
            ECR_IMAGE_URL: properties.repositoryURI,
            SUBNETS: properties.vpc?.publicSubnets,
            NAMESPACE: this.namespace,
            SERVICE_ACCOUNT_NAME: this.serviceAccountName,
            TARGET_GROUP_ARN: this.targetGroup.targetGroupArn,
            // Parameter names (not values) - these environment variables tell the app which parameter names to look up
            PET_HISTORY_URL_PARAM_NAME: SSM_PARAMETER_NAMES.PET_HISTORY_URL,
            PET_LIST_ADOPTIONS_URL_PARAM_NAME: SSM_PARAMETER_NAMES.PET_LIST_ADOPTIONS_URL,
            CLEANUP_ADOPTIONS_URL_PARAM_NAME: SSM_PARAMETER_NAMES.CLEANUP_ADOPTIONS_URL,
            PAYMENT_API_URL_PARAM_NAME: SSM_PARAMETER_NAMES.PAYMENT_API_URL,
            FOOD_API_URL_PARAM_NAME: SSM_PARAMETER_NAMES.FOOD_API_URL,
            SEARCH_API_URL_PARAM_NAME: SSM_PARAMETER_NAMES.SEARCH_API_URL,
            RUM_SCRIPT_PARAMETER_NAME: SSM_PARAMETER_NAMES.RUM_SCRIPT_PARAMETER,
        });
        return yaml.parseAllDocuments(deploymentYaml).map((document) => document.toJS());
    }

    configureECSService(): void {
        // Not applicable
    }
    addPermissions(properties: MicroserviceProperties): void {
        this.serviceAccountRole = new Role(this, 'serviceAccountRole', {
            assumedBy: new ServicePrincipal('pods.eks.amazonaws.com').withSessionTags(),
        });

        this.podIdentityAssociation = new CfnPodIdentityAssociation(this, 'podIdentityAssociation', {
            clusterName: properties.eksCluster!.clusterName,
            namespace: this.namespace || 'default',
            roleArn: this.serviceAccountRole.roleArn,
            serviceAccount: this.serviceAccountName || `${properties.name}-sa`,
        });

        const servicePolicy = new Policy(this, 'PetSitePolicy', {
            policyName: 'PetSiteAccessPolicy',
            document: new PolicyDocument({
                statements: [Microservice.getDefaultSSMPolicy(this, PARAMETER_STORE_PREFIX)],
            }),
            roles: [this.serviceAccountRole],
        });

        this.serviceAccountRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

        NagSuppressions.addResourceSuppressions(
            servicePolicy,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for the pod role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Permissions are acceptable for the pod role',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            this.serviceAccountRole,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for the pod role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Permissions are acceptable for the pod role',
                },
            ],
            true,
        );
    }
    createOutputs(): void {
        if (this.loadBalancer) {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.PETSITE_URL]: `https://${this.distribution.distributionDomainName}`,
                    }),
                ),
            );
        }
    }
}
