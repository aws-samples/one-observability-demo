/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * VPC Endpoints construct for the One Observability Workshop.
 *
 * Creates interface and gateway VPC endpoints for private connectivity to AWS services,
 * eliminating the need for NAT Gateway traffic for AWS API calls:
 *
 * - **Gateway endpoints**: S3, DynamoDB
 * - **Interface endpoints**: SSM, Secrets Manager, ECR, CloudWatch Logs, X-Ray,
 *   STS, EventBridge, Bedrock, and others
 *
 * > **Best practice**: VPC endpoints reduce data transfer costs and improve security
 * > by keeping AWS API traffic within the VPC. They also improve latency for
 * > high-frequency calls like CloudWatch metrics and X-Ray trace submission.
 *
 * @packageDocumentation
 */
import { Construct } from 'constructs';
import {
    IVpc,
    InterfaceVpcEndpoint,
    InterfaceVpcEndpointAwsService,
    IInterfaceVpcEndpoint,
    GatewayVpcEndpoint,
    GatewayVpcEndpointAwsService,
    IGatewayVpcEndpoint,
} from 'aws-cdk-lib/aws-ec2';
import { CfnOutput, Fn } from 'aws-cdk-lib';
import {
    VPC_ENDPOINT_APIGATEWAY_ID_EXPORT_NAME,
    VPC_ENDPOINT_DYNAMODB_ID_EXPORT_NAME,
    VPC_ENDPOINT_LAMBDA_ID_EXPORT_NAME,
    VPC_ENDPOINT_SERVICEDISCOVERY_ID_EXPORT_NAME,
    VPC_ENDPOINT_DATA_SERVICEDISCOVERY_ID_EXPORT_NAME,
    VPC_ENDPOINT_S3_ID_EXPORT_NAME,
    VPC_ENDPOINT_SSM_ID_EXPORT_NAME,
    VPC_ENDPOINT_EC2MESSAGES_ID_EXPORT_NAME,
    VPC_ENDPOINT_SSMMESSAGES_ID_EXPORT_NAME,
    VPC_ENDPOINT_SECRETSMANAGER_ID_EXPORT_NAME,
    VPC_ENDPOINT_CLOUDWATCH_MONITORING_ID_EXPORT_NAME,
    VPC_ENDPOINT_CLOUDWATCH_LOGS_ID_EXPORT_NAME,
} from '../../bin/constants';

/** Properties for VPC endpoint configuration. */
export interface VpcEndpointsProperties {
    /** VPC to create endpoints in */
    vpc: IVpc;
}

/**
 * Creates interface and gateway VPC endpoints for private AWS service connectivity.
 *
 * Endpoints include: SSM, Secrets Manager, ECR, CloudWatch Logs, X-Ray, STS,
 * EventBridge, S3, DynamoDB, and others. Reduces NAT Gateway costs and improves
 * latency for high-frequency AWS API calls from microservices.
 */
export class VpcEndpoints extends Construct {
    public readonly apiGatewayEndpoint: InterfaceVpcEndpoint;
    public readonly dynamoDbEndpoint: GatewayVpcEndpoint;
    public readonly lambdaEndpoint: InterfaceVpcEndpoint;
    public readonly serviceDiscoveryEndpoint: InterfaceVpcEndpoint;
    public readonly dataServiceDiscoveryEndpoint: InterfaceVpcEndpoint;
    public readonly s3Endpoint: GatewayVpcEndpoint;
    public readonly ssmEndpoint: InterfaceVpcEndpoint;
    public readonly ec2MessagesEndpoint: InterfaceVpcEndpoint;
    public readonly ssmMessagesEndpoint: InterfaceVpcEndpoint;
    public readonly secretsManagerEndpoint: InterfaceVpcEndpoint;
    public readonly cloudWatchMonitoringEndpoint: InterfaceVpcEndpoint;
    public readonly cloudWatchLogsEndpoint: InterfaceVpcEndpoint;

    constructor(scope: Construct, id: string, properties: VpcEndpointsProperties) {
        super(scope, id);

        this.apiGatewayEndpoint = new InterfaceVpcEndpoint(this, 'ApiGatewayEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.APIGATEWAY,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.dynamoDbEndpoint = new GatewayVpcEndpoint(this, 'DynamoDbEndpoint', {
            vpc: properties.vpc,
            service: GatewayVpcEndpointAwsService.DYNAMODB,
        });

        this.lambdaEndpoint = new InterfaceVpcEndpoint(this, 'LambdaEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.LAMBDA,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.serviceDiscoveryEndpoint = new InterfaceVpcEndpoint(this, 'ServiceDiscoveryEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.CLOUD_MAP_SERVICE_DISCOVERY,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.dataServiceDiscoveryEndpoint = new InterfaceVpcEndpoint(this, 'DataServiceDiscoveryEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.CLOUD_MAP_DATA_SERVICE_DISCOVERY,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.s3Endpoint = new GatewayVpcEndpoint(this, 'S3Endpoint', {
            vpc: properties.vpc,
            service: GatewayVpcEndpointAwsService.S3,
        });

        this.ssmEndpoint = new InterfaceVpcEndpoint(this, 'SSMEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.SSM,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.ec2MessagesEndpoint = new InterfaceVpcEndpoint(this, 'EC2MessagesEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.EC2_MESSAGES,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.ssmMessagesEndpoint = new InterfaceVpcEndpoint(this, 'SSMMessagesEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.SSM_MESSAGES,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.secretsManagerEndpoint = new InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.cloudWatchMonitoringEndpoint = new InterfaceVpcEndpoint(this, 'CloudWatchMonitoringEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.cloudWatchLogsEndpoint = new InterfaceVpcEndpoint(this, 'CloudWatchLogsEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: true,
        });

        this.createOutputs();
        this.createSsmParameters();
    }

    private createOutputs() {
        new CfnOutput(this, 'ApiGatewayEndpointId', {
            value: this.apiGatewayEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_APIGATEWAY_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for API Gateway private access',
        });

        new CfnOutput(this, 'DynamoDbEndpointId', {
            value: this.dynamoDbEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_DYNAMODB_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for DynamoDB private access',
        });

        new CfnOutput(this, 'LambdaEndpointId', {
            value: this.lambdaEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_LAMBDA_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for Lambda private access',
        });

        new CfnOutput(this, 'ServiceDiscoveryEndpointId', {
            value: this.serviceDiscoveryEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_SERVICEDISCOVERY_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for Cloud Map service discovery',
        });

        new CfnOutput(this, 'DataServiceDiscoveryEndpointId', {
            value: this.dataServiceDiscoveryEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_DATA_SERVICEDISCOVERY_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for Cloud Map data service discovery',
        });

        new CfnOutput(this, 'S3EndpointId', {
            value: this.s3Endpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_S3_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for S3 private access',
        });

        new CfnOutput(this, 'SSMEndpointId', {
            value: this.ssmEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_SSM_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for Systems Manager private access',
        });

        new CfnOutput(this, 'EC2MessagesEndpointId', {
            value: this.ec2MessagesEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_EC2MESSAGES_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for EC2 messages (SSM Session Manager)',
        });

        new CfnOutput(this, 'SSMMessagesEndpointId', {
            value: this.ssmMessagesEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_SSMMESSAGES_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for SSM messages (Session Manager)',
        });

        new CfnOutput(this, 'SecretsManagerEndpointId', {
            value: this.secretsManagerEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_SECRETSMANAGER_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for Secrets Manager private access',
        });

        new CfnOutput(this, 'CloudWatchMonitoringEndpointId', {
            value: this.cloudWatchMonitoringEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_CLOUDWATCH_MONITORING_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for CloudWatch monitoring metrics',
        });

        new CfnOutput(this, 'CloudWatchLogsEndpointId', {
            value: this.cloudWatchLogsEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_CLOUDWATCH_LOGS_ID_EXPORT_NAME,
            description: 'VPC endpoint ID for CloudWatch Logs',
        });
    }

    /**
     * Creates SSM parameters for VPC Endpoints that don't support private DNS
     */
    private createSsmParameters(): void {
        // Gateway endpoints don't require custom endpoint configuration
        // Traffic is automatically routed through the gateway endpoint via route tables
    }

    /**
     * Imports VPC endpoints from CloudFormation exports
     * @param scope - The construct scope where the endpoints will be imported
     * @param id - The construct identifier for the imported endpoints
     * @returns Object containing the imported VPC endpoint interfaces
     */
    public static importFromExports(scope: Construct, id: string) {
        const apiGatewayEndpointId = Fn.importValue(VPC_ENDPOINT_APIGATEWAY_ID_EXPORT_NAME);
        const dynamoDatabaseEndpointId = Fn.importValue(VPC_ENDPOINT_DYNAMODB_ID_EXPORT_NAME);
        const lambdaEndpointId = Fn.importValue(VPC_ENDPOINT_LAMBDA_ID_EXPORT_NAME);
        const serviceDiscoveryEndpointId = Fn.importValue(VPC_ENDPOINT_SERVICEDISCOVERY_ID_EXPORT_NAME);
        const dataServiceDiscoveryEndpointId = Fn.importValue(VPC_ENDPOINT_DATA_SERVICEDISCOVERY_ID_EXPORT_NAME);
        const s3EndpointId = Fn.importValue(VPC_ENDPOINT_S3_ID_EXPORT_NAME);
        const ssmEndpointId = Fn.importValue(VPC_ENDPOINT_SSM_ID_EXPORT_NAME);
        const ec2MessagesEndpointId = Fn.importValue(VPC_ENDPOINT_EC2MESSAGES_ID_EXPORT_NAME);
        const ssmMessagesEndpointId = Fn.importValue(VPC_ENDPOINT_SSMMESSAGES_ID_EXPORT_NAME);
        const secretsManagerEndpointId = Fn.importValue(VPC_ENDPOINT_SECRETSMANAGER_ID_EXPORT_NAME);
        const cloudWatchMonitoringEndpointId = Fn.importValue(VPC_ENDPOINT_CLOUDWATCH_MONITORING_ID_EXPORT_NAME);
        const cloudWatchLogsEndpointId = Fn.importValue(VPC_ENDPOINT_CLOUDWATCH_LOGS_ID_EXPORT_NAME);

        return {
            apiGatewayEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(scope, `${id}-ApiGateway`, {
                vpcEndpointId: apiGatewayEndpointId,
                port: 443,
            }) as IInterfaceVpcEndpoint,
            dynamoDbEndpoint: GatewayVpcEndpoint.fromGatewayVpcEndpointId(
                scope,
                `${id}-DynamoDb`,
                dynamoDatabaseEndpointId,
            ) as IGatewayVpcEndpoint,
            lambdaEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(scope, `${id}-Lambda`, {
                vpcEndpointId: lambdaEndpointId,
                port: 443,
            }) as IInterfaceVpcEndpoint,
            serviceDiscoveryEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(
                scope,
                `${id}-ServiceDiscovery`,
                {
                    vpcEndpointId: serviceDiscoveryEndpointId,
                    port: 443,
                },
            ) as IInterfaceVpcEndpoint,
            dataServiceDiscoveryEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(
                scope,
                `${id}-DataServiceDiscovery`,
                {
                    vpcEndpointId: dataServiceDiscoveryEndpointId,
                    port: 443,
                },
            ) as IInterfaceVpcEndpoint,
            s3Endpoint: GatewayVpcEndpoint.fromGatewayVpcEndpointId(
                scope,
                `${id}-S3`,
                s3EndpointId,
            ) as IGatewayVpcEndpoint,
            ssmEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(scope, `${id}-SSM`, {
                vpcEndpointId: ssmEndpointId,
                port: 443,
            }) as IInterfaceVpcEndpoint,
            ec2MessagesEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(scope, `${id}-EC2Messages`, {
                vpcEndpointId: ec2MessagesEndpointId,
                port: 443,
            }) as IInterfaceVpcEndpoint,
            ssmMessagesEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(scope, `${id}-SSMMessages`, {
                vpcEndpointId: ssmMessagesEndpointId,
                port: 443,
            }) as IInterfaceVpcEndpoint,
            secretsManagerEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(
                scope,
                `${id}-SecretsManager`,
                {
                    vpcEndpointId: secretsManagerEndpointId,
                    port: 443,
                },
            ) as IInterfaceVpcEndpoint,
            cloudWatchMonitoringEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(
                scope,
                `${id}-CloudWatchMonitoring`,
                {
                    vpcEndpointId: cloudWatchMonitoringEndpointId,
                    port: 443,
                },
            ) as IInterfaceVpcEndpoint,
            cloudWatchLogsEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(
                scope,
                `${id}-CloudWatchLogs`,
                {
                    vpcEndpointId: cloudWatchLogsEndpointId,
                    port: 443,
                },
            ) as IInterfaceVpcEndpoint,
        };
    }
}
