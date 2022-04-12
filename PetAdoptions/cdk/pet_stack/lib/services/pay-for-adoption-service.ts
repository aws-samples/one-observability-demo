import * as cdk from 'aws-cdk-lib/core';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { EcsService, EcsServiceProps } from './ecs-service'
import { Construct } from 'constructs'

export interface PayForAdoptionServiceProps extends EcsServiceProps {
  database: rds.ServerlessCluster
}

export class PayForAdoptionService extends EcsService {

  constructor(scope: Construct, id: string, props: PayForAdoptionServiceProps) {
    super(scope, id, props);

    props.database.secret?.grantRead(this.taskDefinition.taskRole);
  }

  containerImageFromRepository(repositoryURI: string) : ecs.ContainerImage {
    return ecs.ContainerImage.fromRegistry(`${repositoryURI}/pet-payforadoption:latest`)
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromDockerImageAsset(new DockerImageAsset(this,"pay-for-adoption", {
      directory: "./resources/microservices/payforadoption-go"
    }))
  }
}
