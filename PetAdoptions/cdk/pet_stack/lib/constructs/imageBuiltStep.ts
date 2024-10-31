import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { CodeBuildStep, CodePipelineSource } from "aws-cdk-lib/pipelines";

export interface ImageBuildStepProps {
    repositoryName: string;
    repositoryUri: string;
    source: CodePipelineSource;
    account: string;
    region: string;
    branchName: string;

}

export class ImageBuildStep extends CodeBuildStep {
    constructor(name: string, props: ImageBuildStepProps) {
        super(name, {
            commands: [
                'nohup /usr/local/bin/dockerd --host=unix:///var/run/docker.sock --host=tcp://127.0.0.1:2375 --storage-driver=overlay2 &',
                'timeout 15 sh -c "until docker info; do echo .; sleep 1; done"',
                'cd ${BASE_PATH}',
                'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
                'docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
                'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
                'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG'
            ],
            rolePolicyStatements: [
                new PolicyStatement({
                    actions: [
                      'ecr:*',
                    ],
                    resources: ['*'],
                  }),
            ],
            input: props.source,
            buildEnvironment: {
                privileged: true
            },
            env: {
                'AWS_ACCOUNT_ID': props.account,
                'AWS_DEFAULT_REGION': props.region,
                'IMAGE_TAG': "latest",
                'ECR_REPOSITORY_URL': props.repositoryUri,
                'IMAGE_REPO_NAME': props.repositoryName,
                'BASE_PATH': `one-observability-demo-${props.branchName}/${props.repositoryName}`
            }
        });

        this.consumedStackOutputs.push()
    }
}