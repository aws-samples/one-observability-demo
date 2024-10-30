import { Stack } from 'aws-cdk-lib';
import { WorkshopNetwork } from '../constructs/network';
import { NagSuppressions } from "cdk-nag";
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface CoreStackProps {
    name: string,
    awsHostedWorkshop: boolean
}

export class CoreStack extends Stack {
    public readonly network;
    constructor(scope: Construct, id: string, props: CoreStackProps) {
        super(scope, id);

        // Suppressions for the Core Stack
        NagSuppressions.addStackSuppressions(this, [
            { id: "AwsSolutions-IAM4", reason: "Stack level suppression, managed policies are aceptable in this workshop."}
        ])

        var vpc = undefined;

        const vpcid = this.node.tryGetContext('vpcid');


        if (vpcid != undefined) {
            vpc = Vpc.fromLookup(this, 'VPC', {
                vpcId: vpcid,
            });
        }
        else {
            // Network (VPC, Routes, etc)
            this.network = new WorkshopNetwork(this, 'WorkshopNetwork', {
                name: props.name,
                cidrRange: "11.0.0.0/16"
            });
            vpc = this.network.vpc;
        }

        // // Stack Level suppressions (TODO: move to the construct if possible)
        // NagSuppressions.addResourceSuppressionsByPath(this,
        //     [
        //         "/" + id + "/@aws-cdk--aws-eks.ClusterResourceProvider",
        //         "/" + id + "/@aws-cdk--aws-eks.KubectlProvider"
        //     ],
        //     [
        //         {
        //             id: "AwsSolutions-IAM5",
        //             reason: "Creation role is created by the EKS cluster."             
        //         },
        //         {
        //             id: "AwsSolutions-IAM4",
        //             reason: "Managed policy created by the default cdk construct",
        //         },
        //         {
        //             id: "AwsSolutions-L1",
        //             reason: "Lambda is created inside of the cdk eks module"
        //         }                
        //     ],
        //     true
        // ); 

    }
}