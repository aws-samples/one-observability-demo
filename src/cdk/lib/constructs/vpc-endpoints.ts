/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Construct } from 'constructs';
import { IVpc, InterfaceVpcEndpoint, InterfaceVpcEndpointAwsService, IInterfaceVpcEndpoint } from 'aws-cdk-lib/aws-ec2';
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

export interface VpcEndpointsProperties {
    vpc: IVpc;
}

export class VpcEndpoints extends Construct {
    public readonly apiGatewayEndpoint: InterfaceVpcEndpoint;
    public readonly dynamoDbEndpoint: InterfaceVpcEndpoint;
    public readonly lambdaEndpoint: InterfaceVpcEndpoint;
    public readonly serviceDiscoveryEndpoint: InterfaceVpcEndpoint;
    public readonly dataServiceDiscoveryEndpoint: InterfaceVpcEndpoint;
    public readonly s3Endpoint: InterfaceVpcEndpoint;
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

        this.dynamoDbEndpoint = new InterfaceVpcEndpoint(this, 'DynamoDbEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.DYNAMODB,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: false, // Not Supported by DynamoDB
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

        this.s3Endpoint = new InterfaceVpcEndpoint(this, 'S3Endpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.S3,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: false, // Requires a Gateway
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
    }

    private createOutputs() {
        new CfnOutput(this, 'ApiGatewayEndpointId', {
            value: this.apiGatewayEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_APIGATEWAY_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'DynamoDbEndpointId', {
            value: this.dynamoDbEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_DYNAMODB_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'LambdaEndpointId', {
            value: this.lambdaEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_LAMBDA_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'ServiceDiscoveryEndpointId', {
            value: this.serviceDiscoveryEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_SERVICEDISCOVERY_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'DataServiceDiscoveryEndpointId', {
            value: this.dataServiceDiscoveryEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_DATA_SERVICEDISCOVERY_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'S3EndpointId', {
            value: this.s3Endpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_S3_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'SSMEndpointId', {
            value: this.ssmEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_SSM_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'EC2MessagesEndpointId', {
            value: this.ec2MessagesEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_EC2MESSAGES_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'SSMMessagesEndpointId', {
            value: this.ssmMessagesEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_SSMMESSAGES_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'SecretsManagerEndpointId', {
            value: this.secretsManagerEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_SECRETSMANAGER_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'CloudWatchMonitoringEndpointId', {
            value: this.cloudWatchMonitoringEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_CLOUDWATCH_MONITORING_ID_EXPORT_NAME,
        });

        new CfnOutput(this, 'CloudWatchLogsEndpointId', {
            value: this.cloudWatchLogsEndpoint.vpcEndpointId,
            exportName: VPC_ENDPOINT_CLOUDWATCH_LOGS_ID_EXPORT_NAME,
        });
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
            dynamoDbEndpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(scope, `${id}-DynamoDb`, {
                vpcEndpointId: dynamoDatabaseEndpointId,
                port: 443,
            }) as IInterfaceVpcEndpoint,
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
            s3Endpoint: InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(scope, `${id}-S3`, {
                vpcEndpointId: s3EndpointId,
                port: 443,
            }) as IInterfaceVpcEndpoint,
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
