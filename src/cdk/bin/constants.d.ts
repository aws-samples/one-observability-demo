/**
 * Export name constants for CloudFormation stack outputs.
 *
 * This module contains all the export names used for cross-stack references
 * in the One Observability Workshop CDK application.
 *
 * @packageDocumentation
 */
export declare const VPC_ID_EXPORT_NAME = "WorkshopVPC";
export declare const VPC_CIDR_EXPORT_NAME = "WorkshopVPCCidr";
export declare const VPC_PRIVATE_SUBNETS_EXPORT_NAME = "WorkshopVPCPrivateSubnets";
export declare const VPC_PUBLIC_SUBNETS_EXPORT_NAME = "WorkshopVPCPublicSubnets";
export declare const VPC_ISOLATED_SUBNETS_EXPORT_NAME = "WorkshopVPCIsolatedSubnets";
export declare const VPC_AVAILABILITY_ZONES_EXPORT_NAME = "WorkshopVPCAvailabilityZones";
export declare const VPC_PRIVATE_SUBNET_CIDRS_EXPORT_NAME = "WorkshopVPCPrivateSubnetCidrs";
export declare const VPC_PUBLIC_SUBNET_CIDRS_EXPORT_NAME = "WorkshopVPCPublicSubnetCidrs";
export declare const VPC_ISOLATED_SUBNET_CIDRS_EXPORT_NAME = "WorkshopVPCIsolatedSubnetCidrs";
export declare const SNS_TOPIC_ARN_EXPORT_NAME = "WorkshopSNSTopicArn";
export declare const SQS_QUEUE_ARN_EXPORT_NAME = "WorkshopSQSQueueArn";
export declare const SQS_QUEUE_URL_EXPORT_NAME = "WorkshopSQSQueueUrl";
export declare const ECS_CLUSTER_ARN_EXPORT_NAME = "WorkshopECSClusterArn";
export declare const ECS_CLUSTER_NAME_EXPORT_NAME = "WorkshopECSClusterName";
export declare const ECS_SECURITY_GROUP_ID_EXPORT_NAME = "WorkshopECSSecurityGroupId";
export declare const EKS_CLUSTER_ARN_EXPORT_NAME = "WorkshopEKSClusterArn";
export declare const EKS_CLUSTER_NAME_EXPORT_NAME = "WorkshopEKSClusterName";
export declare const EKS_SECURITY_GROUP_ID_EXPORT_NAME = "WorkshopEKSSecurityGroupId";
export declare const EKS_KUBECTL_ROLE_ARN_EXPORT_NAME = "WorkshopEKSKubectlRoleArn";
export declare const EKS_OPEN_ID_CONNECT_PROVIDER_ARN_EXPORT_NAME = "WorkshopEKSOpenIdConnectProviderArn";
export declare const EKS_KUBECTL_SECURITY_GROUP_ID_EXPORT_NAME = "WorkshopEKSKubectlSecurityGroupId";
export declare const EKS_KUBECTL_LAMBDA_ROLE_ARN_EXPORT_NAME = "WorkshopEKSKubectlLambdaRoleArn";
export declare const AURORA_CLUSTER_ARN_EXPORT_NAME = "WorkshopAuroraClusterArn";
export declare const AURORA_CLUSTER_ENDPOINT_EXPORT_NAME = "WorkshopAuroraClusterEndpoint";
export declare const AURORA_SECURITY_GROUP_ID_EXPORT_NAME = "WorkshopAuroraSecurityGroupId";
export declare const AURORA_ADMIN_SECRET_ARN_EXPORT_NAME = "WorkshopAuroraAdminSecretArn";
export declare const DYNAMODB_TABLE_ARN_EXPORT_NAME = "WorkshopDynamoDBTableArn";
export declare const DYNAMODB_TABLE_NAME_EXPORT_NAME = "WorkshopDynamoDBTableName";
export declare const OPENSEARCH_COLLECTION_ARN_EXPORT_NAME = "WorkshopOpenSearchCollectionArn";
export declare const OPENSEARCH_COLLECTION_ID_EXPORT_NAME = "WorkshopOpenSearchCollectionId";
export declare const OPENSEARCH_COLLECTION_ENDPOINT_EXPORT_NAME = "WorkshopOpenSearchCollectionEndpoint";
export declare const OPENSEARCH_APPLICATION_ARN_EXPORT_NAME = "WorkshopOpenSearchApplicationArn";
export declare const OPENSEARCH_APPLICATION_ID_EXPORT_NAME = "WorkshopOpenSearchApplicationId";
export declare const OPENSEARCH_PIPELINE_ARN_EXPORT_NAME = "WorkshopOpenSearchPipelineArn";
export declare const OPENSEARCH_PIPELINE_ENDPOINT_EXPORT_NAME = "WorkshopOpenSearchPipelineEndpoint";
export declare const OPENSEARCH_PIPELINE_ROLE_ARN_EXPORT_NAME = "WorkshopOpenSearchPipelineRoleArn";
export declare const VPC_ENDPOINT_APIGATEWAY_ID_EXPORT_NAME = "WorkshopVPCEndpointApiGatewayId";
export declare const VPC_ENDPOINT_DYNAMODB_ID_EXPORT_NAME = "WorkshopVPCEndpointDynamoDbId";
export declare const VPC_ENDPOINT_LAMBDA_ID_EXPORT_NAME = "WorkshopVPCEndpointLambdaId";
export declare const VPC_ENDPOINT_SERVICEDISCOVERY_ID_EXPORT_NAME = "WorkshopVPCEndpointServiceDiscoveryId";
export declare const VPC_ENDPOINT_DATA_SERVICEDISCOVERY_ID_EXPORT_NAME = "WorkshopVPCEndpointDataServiceDiscoveryId";
export declare const VPC_ENDPOINT_S3_ID_EXPORT_NAME = "WorkshopVPCEndpointS3Id";
export declare const VPC_ENDPOINT_SSM_ID_EXPORT_NAME = "WorkshopVPCEndpointSSMId";
export declare const VPC_ENDPOINT_EC2MESSAGES_ID_EXPORT_NAME = "WorkshopVPCEndpointEC2MessagesId";
export declare const VPC_ENDPOINT_SSMMESSAGES_ID_EXPORT_NAME = "WorkshopVPCEndpointSSMMessagesId";
export declare const VPC_ENDPOINT_SECRETSMANAGER_ID_EXPORT_NAME = "WorkshopVPCEndpointSecretsManagerId";
export declare const VPC_ENDPOINT_CLOUDWATCH_MONITORING_ID_EXPORT_NAME = "WorkshopVPCEndpointCloudWatchMonitoringId";
export declare const VPC_ENDPOINT_CLOUDWATCH_LOGS_ID_EXPORT_NAME = "WorkshopVPCEndpointCloudWatchLogsId";
export declare const CLOUDMAP_NAMESPACE_ID_EXPORT_NAME = "WorkshopCloudMapNamespaceId";
export declare const CLOUDMAP_NAMESPACE_NAME_EXPORT_NAME = "WorkshopCloudMapNamespaceName";
export declare const CLOUDMAP_NAMESPACE_ARN_EXPORT_NAME = "WorkshopCloudMapNamespaceArn";
export declare const ASSETS_BUCKET_NAME_EXPORT_NAME = "WorkshopAssetsBucketName";
export declare const ASSETS_BUCKET_ARN_EXPORT_NAME = "WorkshopAssetsBucketArn";
export declare const EVENTBUS_ARN_EXPORT_NAME = "WorkshopEventBusArn";
export declare const EVENTBUS_NAME_EXPORT_NAME = "WorkshopEventBusName";
export declare const SSM_PARAMETER_NAMES: {
    readonly PETSITE_URL: "petsiteurl";
    readonly IMAGES_CDN_URL: "imagescdnurl";
    readonly PAYMENT_API_URL: "paymentapiurl";
    readonly PAY_FOR_ADOPTION_METRICS_URL: "payforadoptionmetricsurl";
    readonly CLEANUP_ADOPTIONS_URL: "cleanupadoptionsurl";
    readonly FOOD_API_URL: "petfoodapiurl";
    readonly PET_FOOD_METRICS_URL: "petfoodmetricsurl";
    readonly PET_FOOD_CART_URL: "petfoodcarturl";
    readonly PET_LIST_ADOPTIONS_URL: "petlistadoptionsurl";
    readonly PET_LIST_ADOPTIONS_METRICS_URL: "petlistadoptionsmetricsurl";
    readonly SEARCH_API_URL: "searchapiurl";
    readonly S3_BUCKET_NAME: "s3bucketname";
    readonly DYNAMODB_TABLE_NAME: "dynamodbtablename";
    readonly PET_HISTORY_URL: "pethistoryurl";
    readonly RUM_SCRIPT_PARAMETER: "rumscriptparameter";
    readonly PET_ADOPTION_TABLE_NAME: "dynamodbtablename";
    readonly PET_FOODS_TABLE_NAME: "foods_table_name";
    readonly PET_FOODS_CART_TABLE_NAME: "carts_table_name";
    readonly RDS_SECRET_ARN_NAME: "rdssecretarn";
    readonly RDS_READER_ENDPOINT_NAME: "rds-reader-endpoint";
    readonly RDS_WRITER_ENDPOINT_NAME: "rds-writer-endpoint";
    readonly RDS_DATABASE_NAME: "rds-database-name";
};
