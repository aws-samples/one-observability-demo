/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Export name constants for CloudFormation stack outputs.
 *
 * This module contains all the export names used for cross-stack references
 * in the One Observability Workshop CDK application.
 *
 * @packageDocumentation
 */

// VPC Export Names
export const VPC_ID_EXPORT_NAME = 'WorkshopVPC';
export const VPC_CIDR_EXPORT_NAME = 'WorkshopVPCCidr';
export const VPC_PRIVATE_SUBNETS_EXPORT_NAME = 'WorkshopVPCPrivateSubnets';
export const VPC_PUBLIC_SUBNETS_EXPORT_NAME = 'WorkshopVPCPublicSubnets';
export const VPC_ISOLATED_SUBNETS_EXPORT_NAME = 'WorkshopVPCIsolatedSubnets';
export const VPC_AVAILABILITY_ZONES_EXPORT_NAME = 'WorkshopVPCAvailabilityZones';
export const VPC_PRIVATE_SUBNET_CIDRS_EXPORT_NAME = 'WorkshopVPCPrivateSubnetCidrs';
export const VPC_PUBLIC_SUBNET_CIDRS_EXPORT_NAME = 'WorkshopVPCPublicSubnetCidrs';
export const VPC_ISOLATED_SUBNET_CIDRS_EXPORT_NAME = 'WorkshopVPCIsolatedSubnetCidrs';

// SNS/SQS Export Names
export const SNS_TOPIC_ARN_EXPORT_NAME = 'WorkshopSNSTopicArn';
export const SQS_QUEUE_ARN_EXPORT_NAME = 'WorkshopSQSQueueArn';
export const SQS_QUEUE_URL_EXPORT_NAME = 'WorkshopSQSQueueUrl';

// ECS Export Names
export const ECS_CLUSTER_ARN_EXPORT_NAME = 'WorkshopECSClusterArn';
export const ECS_CLUSTER_NAME_EXPORT_NAME = 'WorkshopECSClusterName';
export const ECS_SECURITY_GROUP_ID_EXPORT_NAME = 'WorkshopECSSecurityGroupId';

// EKS Export Names
export const EKS_CLUSTER_ARN_EXPORT_NAME = 'WorkshopEKSClusterArn';
export const EKS_CLUSTER_NAME_EXPORT_NAME = 'WorkshopEKSClusterName';
export const EKS_SECURITY_GROUP_ID_EXPORT_NAME = 'WorkshopEKSSecurityGroupId';
export const EKS_KUBECTL_ROLE_ARN_EXPORT_NAME = 'WorkshopEKSKubectlRoleArn';
export const EKS_OPEN_ID_CONNECT_PROVIDER_ARN_EXPORT_NAME = 'WorkshopEKSOpenIdConnectProviderArn';
export const EKS_KUBECTL_SECURITY_GROUP_ID_EXPORT_NAME = 'WorkshopEKSKubectlSecurityGroupId';
export const EKS_KUBECTL_LAMBDA_ROLE_ARN_EXPORT_NAME = 'WorkshopEKSKubectlLambdaRoleArn';

// Aurora Database Export Names
export const AURORA_CLUSTER_ARN_EXPORT_NAME = 'WorkshopAuroraClusterArn';
export const AURORA_CLUSTER_ENDPOINT_EXPORT_NAME = 'WorkshopAuroraClusterEndpoint';
export const AURORA_SECURITY_GROUP_ID_EXPORT_NAME = 'WorkshopAuroraSecurityGroupId';
export const AURORA_ADMIN_SECRET_ARN_EXPORT_NAME = 'WorkshopAuroraAdminSecretArn'; //pragma: allowlist secret

// DynamoDB Export Names
export const DYNAMODB_TABLE_ARN_EXPORT_NAME = 'WorkshopDynamoDBTableArn';
export const DYNAMODB_TABLE_NAME_EXPORT_NAME = 'WorkshopDynamoDBTableName';

// OpenSearch Serverless Export Names
export const OPENSEARCH_COLLECTION_ARN_EXPORT_NAME = 'WorkshopOpenSearchCollectionArn';
export const OPENSEARCH_COLLECTION_ID_EXPORT_NAME = 'WorkshopOpenSearchCollectionId';
export const OPENSEARCH_COLLECTION_ENDPOINT_EXPORT_NAME = 'WorkshopOpenSearchCollectionEndpoint';

// OpenSearch Application Export Names
export const OPENSEARCH_APPLICATION_ARN_EXPORT_NAME = 'WorkshopOpenSearchApplicationArn';
export const OPENSEARCH_APPLICATION_ID_EXPORT_NAME = 'WorkshopOpenSearchApplicationId';

// OpenSearch Ingestion Pipeline Export Names
export const OPENSEARCH_PIPELINE_ARN_EXPORT_NAME = 'WorkshopOpenSearchPipelineArn';
export const OPENSEARCH_PIPELINE_ENDPOINT_EXPORT_NAME = 'WorkshopOpenSearchPipelineEndpoint';
export const OPENSEARCH_PIPELINE_ROLE_ARN_EXPORT_NAME = 'WorkshopOpenSearchPipelineRoleArn';

// VPC Endpoint Export Names
export const VPC_ENDPOINT_APIGATEWAY_ID_EXPORT_NAME = 'WorkshopVPCEndpointApiGatewayId';
export const VPC_ENDPOINT_DYNAMODB_ID_EXPORT_NAME = 'WorkshopVPCEndpointDynamoDbId';
export const VPC_ENDPOINT_LAMBDA_ID_EXPORT_NAME = 'WorkshopVPCEndpointLambdaId';
export const VPC_ENDPOINT_SERVICEDISCOVERY_ID_EXPORT_NAME = 'WorkshopVPCEndpointServiceDiscoveryId';
export const VPC_ENDPOINT_DATA_SERVICEDISCOVERY_ID_EXPORT_NAME = 'WorkshopVPCEndpointDataServiceDiscoveryId';

// CloudMap Export Names
export const CLOUDMAP_NAMESPACE_ID_EXPORT_NAME = 'WorkshopCloudMapNamespaceId';
export const CLOUDMAP_NAMESPACE_NAME_EXPORT_NAME = 'WorkshopCloudMapNamespaceName';
export const CLOUDMAP_NAMESPACE_ARN_EXPORT_NAME = 'WorkshopCloudMapNamespaceArn';

// Assets Export Names
export const ASSETS_BUCKET_NAME_EXPORT_NAME = 'WorkshopAssetsBucketName';
export const ASSETS_BUCKET_ARN_EXPORT_NAME = 'WorkshopAssetsBucketArn';

// EventBridge Export Names
export const EVENTBUS_ARN_EXPORT_NAME = 'WorkshopEventBusArn';
export const EVENTBUS_NAME_EXPORT_NAME = 'WorkshopEventBusName';
