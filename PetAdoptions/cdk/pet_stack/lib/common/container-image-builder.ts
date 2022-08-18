/**
 * Create a container image from Dockerfile and make it available
 * on a dedicated ECR repository (by default, CDK places all of the
 * container images in the same "CDK Assets" ECR repository)
 *
 * Behind the scenes, this is what happens:
 * 1. The container image is built locally and pushed into the "CDK Assets" ECR repository
 * 2. A dedicated ECR repository is created
 * 3. The container image is copied from "CDK Assets" to the dedicated repository
 */
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecrassets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecrdeploy from 'cdk-ecr-deployment';

import { Construct } from 'constructs';

export interface ContainerImageBuilderProps {
    repositoryName: string,
    dockerImageAssetDirectory: string
}

export class ContainerImageBuilder extends Construct {
    public repositoryUri: string;
    public imageUri: string;

    constructor(scope: Construct, id: string, props: ContainerImageBuilderProps) {
        super(scope, id);

        const repository = new ecr.Repository(this, props.repositoryName + 'Repository', {
            repositoryName: props.repositoryName,
            imageScanOnPush: true,
        });
        const image = new ecrassets.DockerImageAsset(this, props.repositoryName + 'DockerImageAsset', {
          directory: props.dockerImageAssetDirectory
        });
        new ecrdeploy.ECRDeployment(this, props.repositoryName + 'DeployDockerImage', {
          src: new ecrdeploy.DockerImageName(image.imageUri),
          dest: new ecrdeploy.DockerImageName(repository.repositoryUri),
        });

        this.repositoryUri = repository.repositoryUri;
        this.imageUri = `${repository.repositoryUri}:latest`;
    }
}