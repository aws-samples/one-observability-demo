import { Aspects, CfnOutput, Stack, Tags } from 'aws-cdk-lib';
import { WorkshopNetwork } from '../constructs/network';
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from 'constructs';
import * as fs from 'fs';
import path = require('path');
import { Repository } from '../constructs/repository';

export interface CoreStackProps {
    name: string,
    awsHostedWorkshop: boolean
}

export class CoreStack extends Stack {
    public readonly network;
    public readonly repoList = new Map<string, string>();
    constructor(scope: Construct, id: string, props: CoreStackProps) {
        super(scope, id);

        // Suppressions for the Core Stack
        NagSuppressions.addStackSuppressions(this, [
            { id: "AwsSolutions-IAM4", reason: "Stack level suppression, managed policies are aceptable in this workshop."}
        ])

        // Network (VPC, Routes, etc)
        this.network = new WorkshopNetwork(this, 'WorkshopNetwork', {
            name: props.name,
            cidrRange: "11.0.0.0/16"
        });

        const repoFolders = __dirname + "/../../resources/microservices";
        const repositories = fs.readdirSync(repoFolders);        
        const basePath = path.resolve(repoFolders);
        
        repositories.forEach(container => {
        
            const repo = new Repository(this, container, {
                name: container,
                enableScanOnPush: true,
                initialCodePath: basePath + "/" + container,
            });
        
            
            this.repoList.set(container + "Uri", repo.getECRUri());
        });
        
        createOuputs(this,this.repoList);
        
        new CfnOutput(this, 'VpcId', { value: this.network.vpc.vpcId });
        new CfnOutput(this, 'VpcCidr', { value: this.network.vpc.vpcCidrBlock });
        new CfnOutput(this, 'VpcPublicSubnetIds', { value: this.network.vpc.publicSubnets.map(subnet => subnet.subnetId).toString() });
        new CfnOutput(this, 'VpcAvailabilityZones', {value: this.network.vpc.availabilityZones.toString()});

        
        Tags.of(this).add("Workshop","true")
        Tags.of(this).add("ModularVersioning","true")
        Aspects.of(this).add(new AwsSolutionsChecks({verbose: true}));
        
        function createOuputs(scope: Construct ,params: Map<string, string>) {
            params.forEach((value, key) => {
                new CfnOutput(scope, key, { value: value })
            });
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