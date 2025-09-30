import { Construct } from 'constructs';
import { IVpc, InterfaceVpcEndpoint, IInterfaceVpcEndpoint } from 'aws-cdk-lib/aws-ec2';
export interface VpcEndpointsProperties {
    vpc: IVpc;
}
export declare class VpcEndpoints extends Construct {
    readonly apiGatewayEndpoint: InterfaceVpcEndpoint;
    readonly dynamoDbEndpoint: InterfaceVpcEndpoint;
    readonly lambdaEndpoint: InterfaceVpcEndpoint;
    readonly serviceDiscoveryEndpoint: InterfaceVpcEndpoint;
    readonly dataServiceDiscoveryEndpoint: InterfaceVpcEndpoint;
    readonly s3Endpoint: InterfaceVpcEndpoint;
    readonly ssmEndpoint: InterfaceVpcEndpoint;
    readonly ec2MessagesEndpoint: InterfaceVpcEndpoint;
    readonly ssmMessagesEndpoint: InterfaceVpcEndpoint;
    readonly secretsManagerEndpoint: InterfaceVpcEndpoint;
    readonly cloudWatchMonitoringEndpoint: InterfaceVpcEndpoint;
    readonly cloudWatchLogsEndpoint: InterfaceVpcEndpoint;
    constructor(scope: Construct, id: string, properties: VpcEndpointsProperties);
    private createOutputs;
    /**
     * Imports VPC endpoints from CloudFormation exports
     * @param scope - The construct scope where the endpoints will be imported
     * @param id - The construct identifier for the imported endpoints
     * @returns Object containing the imported VPC endpoint interfaces
     */
    static importFromExports(scope: Construct, id: string): {
        apiGatewayEndpoint: IInterfaceVpcEndpoint;
        dynamoDbEndpoint: IInterfaceVpcEndpoint;
        lambdaEndpoint: IInterfaceVpcEndpoint;
        serviceDiscoveryEndpoint: IInterfaceVpcEndpoint;
        dataServiceDiscoveryEndpoint: IInterfaceVpcEndpoint;
        s3Endpoint: IInterfaceVpcEndpoint;
        ssmEndpoint: IInterfaceVpcEndpoint;
        ec2MessagesEndpoint: IInterfaceVpcEndpoint;
        ssmMessagesEndpoint: IInterfaceVpcEndpoint;
        secretsManagerEndpoint: IInterfaceVpcEndpoint;
        cloudWatchMonitoringEndpoint: IInterfaceVpcEndpoint;
        cloudWatchLogsEndpoint: IInterfaceVpcEndpoint;
    };
}
