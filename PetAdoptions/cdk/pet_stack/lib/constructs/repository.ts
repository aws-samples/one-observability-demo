import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct  } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from 'cdk-nag';
import { CodeBuildStep } from 'aws-cdk-lib/pipelines';

export interface RepositoryProps {
    name: string;
    enableScanOnPush: boolean;
    initialCodePath: string;
}


export class Repository extends Construct {
    public readonly imageRepo: ecr.Repository
    public readonly codeBuildStep: CodeBuildStep;

    constructor(scope: Construct, id: string, props: RepositoryProps) {
        super(scope, id);  

        this.imageRepo = new ecr.Repository(scope, props.name + "ImageRepo", {
            repositoryName: props.name, 
            imageScanOnPush: props.enableScanOnPush,
            imageTagMutability: ecr.TagMutability.IMMUTABLE,
            removalPolicy: RemovalPolicy.DESTROY,
            encryption: ecr.RepositoryEncryption.AES_256,
            autoDeleteImages: true
        });
        
    }

    public getECRUri() {
        return this.imageRepo.repositoryUri;
    }
}