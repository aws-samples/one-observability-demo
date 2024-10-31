import { Aspects, CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { WorkshopNetwork } from '../constructs/network';
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from 'constructs';
import * as fs from 'fs';
import path = require('path');
import { Repository } from '../constructs/repository';


export class CoreStack extends Stack {
    public readonly repoList = new Map<string, string>();
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id, props);

        // Suppressions for the Core Stack
        NagSuppressions.addStackSuppressions(this, [
            { id: "AwsSolutions-IAM4", reason: "Stack level suppression, managed policies are aceptable in this workshop."}
        ])

        const repoFolders = __dirname + "/../../resources/microservices";
        const repositories = fs.readdirSync(repoFolders);        
        const basePath = path.resolve(repoFolders);
        
        repositories.forEach(container => {
        
            const repo = new Repository(this, container, {
                name: container,
                enableScanOnPush: true,
                initialCodePath: basePath + "/" + container,
            });
        
            
            this.repoList.set(container, repo.getECRUri());
        });
        
        this.repoList.forEach((value, key) => {
            new CfnOutput(this, key + "Uri", { value: value })
        })
    
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