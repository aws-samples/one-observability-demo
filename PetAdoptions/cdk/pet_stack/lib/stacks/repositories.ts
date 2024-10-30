import { Stack, RemovalPolicy, Tags, Aspects, CfnOutput } from 'aws-cdk-lib';
import { WorkshopNetwork } from '../constructs/network';
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { IVpc, Vpc } from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Repository } from '../constructs/repository';
import { Construct } from 'constructs';

export interface RepotStackProps {
    name: string,
    repositories: string[],
    basePath: string
}

export class RepoStack extends Stack {
    constructor(scope: Construct, id: string, props: RepotStackProps) {
        super(scope, id);

        const repoList = new Map<string, string>();


        const artifactBucket = new s3.Bucket(this, "PipelineArtifacts", {
            removalPolicy: RemovalPolicy.DESTROY,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            autoDeleteObjects: true,
        });        
        
        NagSuppressions.addResourceSuppressions(artifactBucket, [
            {
                id: "AwsSolutions-S1",
                reason: "Access logs not needed for artifact bucket"
            }
        ])
                
        const vpcid = this.node.tryGetContext('vpcid');
        var vpc: IVpc;

        
        if (vpcid != undefined) {
            vpc = Vpc.fromLookup(this, 'VPC', {
                vpcId: vpcid,
            });
        }
        else {
            // Network (VPC, Routes, etc)
            const network = new WorkshopNetwork(this, 'WorkshopNetwork', {
                name: props.name,
                cidrRange: "11.0.0.0/16"
            });
            vpc = network.vpc;
        }
        
        props.repositories.forEach(container => {
        
            const repo = new Repository(this, container, {
                name: container,
                vpc: vpc,
                enableScanOnPush: true,
                initialCodePath: props.basePath + "/" + container,
                artifactBucket: artifactBucket,
            });
        
            
            repoList.set(container + "Uri", repo.getECRUri());
        });
        
        createOuputs(this,repoList);
        
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