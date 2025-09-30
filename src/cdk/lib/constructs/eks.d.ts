import { Construct } from 'constructs';
import { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';
import { Cluster, ICluster } from 'aws-cdk-lib/aws-eks';
export interface EksProperties {
    vpc: IVpc;
    eksEc2Capacity?: number;
    eksEc2InstanceType?: string;
}
export declare class WorkshopEks extends Construct {
    readonly cluster: Cluster;
    constructor(scope: Construct, id: string, properties: EksProperties);
    private setupAddons;
    private setupSuppressions;
    private createExports;
    static importFromExports(scope: Construct, id: string): {
        cluster: ICluster;
        securityGroup: ISecurityGroup;
    };
}
