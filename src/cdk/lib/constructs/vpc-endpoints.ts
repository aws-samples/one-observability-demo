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

    constructor(scope: Construct, id: string, properties: VpcEndpointsProperties) {
        super(scope, id);

        this.apiGatewayEndpoint = new InterfaceVpcEndpoint(this, 'ApiGatewayEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.APIGATEWAY,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: false,
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
            privateDnsEnabled: false,
        });

        this.serviceDiscoveryEndpoint = new InterfaceVpcEndpoint(this, 'ServiceDiscoveryEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.CLOUD_MAP_SERVICE_DISCOVERY,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: false,
        });

        this.dataServiceDiscoveryEndpoint = new InterfaceVpcEndpoint(this, 'DataServiceDiscoveryEndpoint', {
            vpc: properties.vpc,
            service: InterfaceVpcEndpointAwsService.CLOUD_MAP_DATA_SERVICE_DISCOVERY,
            subnets: { subnets: properties.vpc.privateSubnets },
            privateDnsEnabled: false,
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
        };
    }
}
