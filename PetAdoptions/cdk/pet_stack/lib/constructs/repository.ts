import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct  } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from 'cdk-nag';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';

export interface RepositoryProps {
    name: string;
    enableScanOnPush: boolean;
    initialCodePath: string;
    artifactBucket: Bucket;
    vpc: IVpc;
}


export class Repository extends Construct {
    public readonly imageRepo: ecr.Repository
    public readonly codeBuildProject: codebuild.Project;

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

        const codeBuildRole = new iam.Role(scope, props.name + "CodeBuildRole", {
            assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com")
        });

        const codeBuildPolicy = new iam.Policy(this,props.name + "CodeBuildRole", {
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ["ecr:CompleteLayerUpload",
                    "ecr:GetAuthorizationToken",
                    "ecr:UploadLayerPart",
                    "ecr:InitiateLayerUpload",
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:PutImage"],
                    resources: [this.imageRepo.repositoryArn]
                    }
                ),
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ["s3:GetObject",
                    "s3:GetBucket*",
                    "s3:List*",
                    "s3:DeleteObject*",
                    "s3:PutObject",
                    "s3:PutObjectLegalHold",
                    "s3:PutObjectRetention",
                    "s3:PutObjectTagging",
                    "s3:PutObjectVersionTagging",
                    "s3:Abort*"],
                    resources: [
                        props.artifactBucket.bucketArn,
                        props.artifactBucket.arnForObjects("*")
                    ]
                })
            ],
            roles: [codeBuildRole]
        })

        codeBuildRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["ecr:GetAuthorizationToken"],
                resources: ["*"]
            })
        );

        this.codeBuildProject = new codebuild.PipelineProject(scope, props.name + "BuildProject", {
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                  install: {
                    commands: [
                        'nohup /usr/local/bin/dockerd --host=unix:///var/run/docker.sock --host=tcp://127.0.0.1:2375 --storage-driver=overlay2 &',
                        'timeout 15 sh -c "until docker info; do echo .; sleep 1; done"',
                    ]
                  },
                  pre_build: {
                    commands: [
                        'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
                    ]
                  },
                  build: {
                    commands: [
                        'docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
                        'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG'
                    ],
                  },
                  post_build: {
                    commands: [
                        'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG'
                    ]

                  }
                }
            }),
            role: codeBuildRole,
            vpc: props.vpc,
            subnetSelection: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            encryptionKey: props.artifactBucket.encryptionKey,
            environment: {
                environmentVariables: {
                    ECR_REPOSITORY_URL: {
                        value: this.imageRepo.repositoryUri,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    IMAGE_REPO_NAME: {
                        value: this.imageRepo.repositoryName,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    AWS_ACCOUNT_ID: {
                        value: Stack.of(this).account,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    AWS_DEFAULT_REGION: {
                        value: Stack.of(this).region,
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    },
                    IMAGE_TAG: {
                        value: "latest",
                        type: codebuild.BuildEnvironmentVariableType.PLAINTEXT
                    }
                },
                privileged: true,
                buildImage: codebuild.LinuxBuildImage.STANDARD_7_0
            }});


        NagSuppressions.addResourceSuppressions(codeBuildRole, [{
            id: "AwsSolutions-IAM5",
            reason: "Default Permissions applied by the construct are resource *"
        }],true);

        NagSuppressions.addResourceSuppressions(this.codeBuildProject, [
            {
                id: "AwsSolutions-CB4",
                reason: "CMK Key not used to simplify clean-up process"
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Default Permissions applied by the construct are resource *"
            },
            {
                id: "AwsSolutions-CB3",
                reason: "Privilege mode is needed to execute docker build"
            }
        ],true);

        NagSuppressions.addResourceSuppressions(codeBuildPolicy, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Artifact bucket acceptable permissions"
            }
        ]);
        
    }

    public getECRUri() {
        return this.imageRepo.repositoryUri;
    }
}