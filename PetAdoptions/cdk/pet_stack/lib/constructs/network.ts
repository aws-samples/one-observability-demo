import { Construct } from "constructs";
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface WorkshopNetworkProps {
    name: string;
    cidrRange: string;
}

export class WorkshopNetwork extends Construct {
    public readonly vpc : ec2.Vpc;
    constructor(scope: Construct, id: string, props: WorkshopNetworkProps) {
        super(scope, id);  

        // Create a VPC with public and private subnets
        // The VPC where all the microservices will be deployed into
        this.vpc = new ec2.Vpc(this, 'VPC-' + props.name, {
            ipAddresses: ec2.IpAddresses.cidr(props.cidrRange),
            natGateways: 1,
            maxAzs: 2
        });

        const flowLogGroup = new logs.LogGroup(this, 'FlowLogGroup', {
            logGroupName: '/aws/vpcflowlogs/' + this.vpc.vpcId,
            retention: logs.RetentionDays.ONE_WEEK
        });

        const role = new iam.Role(this, 'VPCFlowLogRole', {
            assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com')
        });

        const flowLog = new ec2.FlowLog(this, 'VPCFlowLog', {
            destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup, role),
            resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
            logFormat: [
                ec2.LogFormat.ACCOUNT_ID,
                ec2.LogFormat.ACTION,
                ec2.LogFormat.AZ_ID,
                ec2.LogFormat.BYTES,
                ec2.LogFormat.DST_ADDR,
                ec2.LogFormat.DST_PORT,
                ec2.LogFormat.END_TIMESTAMP,
                ec2.LogFormat.FLOW_DIRECTION,
                ec2.LogFormat.INSTANCE_ID,
                ec2.LogFormat.INTERFACE_ID,
                ec2.LogFormat.LOG_STATUS,
                ec2.LogFormat.PACKETS,
                ec2.LogFormat.PKT_DST_AWS_SERVICE,
                ec2.LogFormat.PKT_DST_ADDR,
                ec2.LogFormat.PKT_SRC_AWS_SERVICE,
                ec2.LogFormat.PKT_SRC_ADDR,
                ec2.LogFormat.PROTOCOL,
                ec2.LogFormat.REGION,
                ec2.LogFormat.SRC_ADDR,
                ec2.LogFormat.SRC_PORT,
                ec2.LogFormat.START_TIMESTAMP,
                ec2.LogFormat.SUBLOCATION_ID,
                ec2.LogFormat.SUBLOCATION_TYPE,
                ec2.LogFormat.SUBNET_ID,
                ec2.LogFormat.TCP_FLAGS,
                ec2.LogFormat.TRAFFIC_PATH,
                ec2.LogFormat.TRAFFIC_TYPE,
                ec2.LogFormat.VERSION,
                ec2.LogFormat.VPC_ID
            ]
        });
    }   
}