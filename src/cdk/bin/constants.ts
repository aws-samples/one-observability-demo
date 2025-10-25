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

/**
 * Defines the architecture used to build the container
 */
export enum ContainerArchitecture {
    ARM64,
    AMD64,
}

// VPC Export Names
export const VPC_ID_EXPORT_NAME = 'public:WorkshopVPC';
export const VPC_CIDR_EXPORT_NAME = 'public:WorkshopVPCCidr';
export const VPC_PRIVATE_SUBNETS_EXPORT_NAME = 'public:WorkshopVPCPrivateSubnets';
export const VPC_PUBLIC_SUBNETS_EXPORT_NAME = 'public:WorkshopVPCPublicSubnets';
export const VPC_ISOLATED_SUBNETS_EXPORT_NAME = 'public:WorkshopVPCIsolatedSubnets';
export const VPC_AVAILABILITY_ZONES_EXPORT_NAME = 'public:WorkshopVPCAvailabilityZones';
export const VPC_PRIVATE_SUBNET_CIDRS_EXPORT_NAME = 'public:WorkshopVPCPrivateSubnetCidrs';
export const VPC_PUBLIC_SUBNET_CIDRS_EXPORT_NAME = 'public:WorkshopVPCPublicSubnetCidrs';
export const VPC_ISOLATED_SUBNET_CIDRS_EXPORT_NAME = 'public:WorkshopVPCIsolatedSubnetCidrs';

// SNS/SQS Export Names
export const SNS_TOPIC_ARN_EXPORT_NAME = 'public:WorkshopSNSTopicArn';
export const SQS_QUEUE_ARN_EXPORT_NAME = 'public:WorkshopSQSQueueArn';
export const SQS_QUEUE_URL_EXPORT_NAME = 'public:WorkshopSQSQueueUrl';

// ECS Export Names
export const ECS_CLUSTER_ARN_EXPORT_NAME = 'public:WorkshopECSClusterArn';
export const ECS_CLUSTER_NAME_EXPORT_NAME = 'public:WorkshopECSClusterName';
export const ECS_SECURITY_GROUP_ID_EXPORT_NAME = 'public:WorkshopECSSecurityGroupId';

// EKS Export Names
export const EKS_CLUSTER_ARN_EXPORT_NAME = 'public:WorkshopEKSClusterArn';
export const EKS_CLUSTER_NAME_EXPORT_NAME = 'public:WorkshopEKSClusterName';
export const EKS_SECURITY_GROUP_ID_EXPORT_NAME = 'public:WorkshopEKSSecurityGroupId';
export const EKS_KUBECTL_ROLE_ARN_EXPORT_NAME = 'public:WorkshopEKSKubectlRoleArn';
export const EKS_OPEN_ID_CONNECT_PROVIDER_ARN_EXPORT_NAME = 'public:WorkshopEKSOpenIdConnectProviderArn';
export const EKS_KUBECTL_SECURITY_GROUP_ID_EXPORT_NAME = 'public:WorkshopEKSKubectlSecurityGroupId';
export const EKS_KUBECTL_LAMBDA_ROLE_ARN_EXPORT_NAME = 'public:WorkshopEKSKubectlLambdaRoleArn';

// Aurora Database Export Names
export const AURORA_CLUSTER_ARN_EXPORT_NAME = 'public:WorkshopAuroraClusterArn';
export const AURORA_CLUSTER_ENDPOINT_EXPORT_NAME = 'public:WorkshopAuroraClusterEndpoint';
export const AURORA_SECURITY_GROUP_ID_EXPORT_NAME = 'public:WorkshopAuroraSecurityGroupId';
export const AURORA_ADMIN_SECRET_ARN_EXPORT_NAME = 'private:WorkshopAuroraAdminSecretArn'; //pragma: allowlist secret

// DynamoDB Export Names
export const DYNAMODB_TABLE_ARN_EXPORT_NAME = 'public:WorkshopDynamoDBTableArn';
export const DYNAMODB_TABLE_NAME_EXPORT_NAME = 'public:WorkshopDynamoDBTableName';

// OpenSearch Serverless Export Names
export const OPENSEARCH_COLLECTION_ARN_EXPORT_NAME = 'public:WorkshopOpenSearchCollectionArn';
export const OPENSEARCH_COLLECTION_ID_EXPORT_NAME = 'public:WorkshopOpenSearchCollectionId';
export const OPENSEARCH_COLLECTION_ENDPOINT_EXPORT_NAME = 'public:WorkshopOpenSearchCollectionEndpoint';

// OpenSearch Application Export Names
export const OPENSEARCH_APPLICATION_ARN_EXPORT_NAME = 'public:WorkshopOpenSearchApplicationArn';
export const OPENSEARCH_APPLICATION_ID_EXPORT_NAME = 'public:WorkshopOpenSearchApplicationId';

// OpenSearch Ingestion Pipeline Export Names
export const OPENSEARCH_PIPELINE_ARN_EXPORT_NAME = 'public:WorkshopOpenSearchPipelineArn';
export const OPENSEARCH_PIPELINE_ENDPOINT_EXPORT_NAME = 'public:WorkshopOpenSearchPipelineEndpoint';
export const OPENSEARCH_PIPELINE_ROLE_ARN_EXPORT_NAME = 'public:WorkshopOpenSearchPipelineRoleArn';

// VPC Endpoint Export Names
export const VPC_ENDPOINT_APIGATEWAY_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointApiGatewayId';
export const VPC_ENDPOINT_DYNAMODB_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointDynamoDbId';
export const VPC_ENDPOINT_LAMBDA_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointLambdaId';
export const VPC_ENDPOINT_SERVICEDISCOVERY_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointServiceDiscoveryId';
export const VPC_ENDPOINT_DATA_SERVICEDISCOVERY_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointDataServiceDiscoveryId';
export const VPC_ENDPOINT_S3_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointS3Id';
export const VPC_ENDPOINT_SSM_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointSSMId';
export const VPC_ENDPOINT_EC2MESSAGES_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointEC2MessagesId';
export const VPC_ENDPOINT_SSMMESSAGES_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointSSMMessagesId';
export const VPC_ENDPOINT_SECRETSMANAGER_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointSecretsManagerId';
export const VPC_ENDPOINT_CLOUDWATCH_MONITORING_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointCloudWatchMonitoringId';
export const VPC_ENDPOINT_CLOUDWATCH_LOGS_ID_EXPORT_NAME = 'public:WorkshopVPCEndpointCloudWatchLogsId';

// CloudMap Export Names
export const CLOUDMAP_NAMESPACE_ID_EXPORT_NAME = 'public:WorkshopCloudMapNamespaceId';
export const CLOUDMAP_NAMESPACE_NAME_EXPORT_NAME = 'public:WorkshopCloudMapNamespaceName';
export const CLOUDMAP_NAMESPACE_ARN_EXPORT_NAME = 'public:WorkshopCloudMapNamespaceArn';

// Assets Export Names
export const ASSETS_BUCKET_NAME_EXPORT_NAME = 'public:WorkshopAssetsBucketName';
export const ASSETS_BUCKET_ARN_EXPORT_NAME = 'public:WorkshopAssetsBucketArn';
export const CLOUDFRONT_DOMAIN_EXPORT_NAME = 'public:WorkshopCloudFrontDomain';
export const CLOUDFRONT_DISTRIBUTION_ID_EXPORT_NAME = 'public:WorkshopCloudFrontDistributionId';

// Application URL Export Names
export const PETSITE_URL_EXPORT_NAME = 'public:WorkshopPetSiteUrl';
export const STATUS_UPDATER_API_URL_EXPORT_NAME = 'public:WorkshopStatusUpdaterApiUrl';

// Pipeline Export Names
export const PIPELINE_ARN_EXPORT_NAME = 'public:WorkshopPipelineArn';

// EventBridge Export Names
export const EVENTBUS_ARN_EXPORT_NAME = 'public:WorkshopEventBusArn';
export const EVENTBUS_NAME_EXPORT_NAME = 'public:WorkshopEventBusName';

// WAFv2 Export Names
export const WAFV2_REGIONAL_ACL_ARN_EXPORT_NAME = 'public:RegionalACLExportName';
export const WAFV2_GLOABL_ACL_ARN_EXPORT_NAME = 'public:GlobalACLExportName';

// SSM Parameter Names - Used across microservices
export const SSM_PARAMETER_NAMES = {
    // PetSite parameters
    PETSITE_URL: 'petsiteurl',
    IMAGES_CDN_URL: 'imagescdnurl',

    // Pay-for-Adoption parameters
    PAYMENT_API_URL: 'paymentapiurl',
    PAY_FOR_ADOPTION_METRICS_URL: 'payforadoptionmetricsurl',
    CLEANUP_ADOPTIONS_URL: 'cleanupadoptionsurl',
    UPDATE_ADOPTION_STATUS_URL: 'updateadoptionstatusurl',

    // PetFood parameters
    FOOD_API_URL: 'petfoodapiurl',
    PET_FOOD_METRICS_URL: 'petfoodmetricsurl',
    PET_FOOD_CART_URL: 'petfoodcarturl',

    // PetList-Adoptions parameters
    PET_LIST_ADOPTIONS_URL: 'petlistadoptionsurl',
    PET_LIST_ADOPTIONS_METRICS_URL: 'petlistadoptionsmetricsurl',

    // PetSearch parameters
    SEARCH_API_URL: 'searchapiurl',

    // Infrastructure parameters
    S3_BUCKET_NAME: 's3bucketname',
    DYNAMODB_TABLE_NAME: 'dynamodbtablename',

    // Additional parameters used by .NET application
    PET_HISTORY_URL: 'pethistoryurl',
    RUM_SCRIPT_PARAMETER: 'rumscriptparameter',

    // DynamoDB Tables
    PET_ADOPTION_TABLE_NAME: 'dynamodbtablename',
    PET_FOODS_TABLE_NAME: 'foods_table_name',
    PET_FOODS_CART_TABLE_NAME: 'carts_table_name',

    // RDS
    RDS_SECRET_ARN_NAME: 'rdssecretarn', //pragma: allowlist secret
    RDS_READER_ENDPOINT_NAME: 'rds-reader-endpoint',
    RDS_WRITER_ENDPOINT_NAME: 'rds-writer-endpoint',
    RDS_DATABASE_NAME: 'rds-database-name',

    // SQS Queue
    SQS_QUEUE_URL: 'queueurl',

    // PetFood Agent parameters
    PETFOOD_AGENT_RUNTIME_ARN: 'petfoodagent-runtime-arn',
} as const;
