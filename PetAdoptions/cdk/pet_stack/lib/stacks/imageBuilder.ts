import { Aspects, CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from 'constructs';
import * as fs from 'fs';
import path = require('path');
import { Repository } from '../constructs/repository';


export class ImageBuilderStack extends Stack {
    public readonly repoList = new Map<string, string>();
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id, props);

        // Suppressions for the ImageBuilder Stack
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
    }
}