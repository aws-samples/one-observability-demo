import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as rds from '@aws-cdk/aws-rds';
import { EcsService, EcsServiceProps } from './ecs-service'

export interface ListAdoptionServiceProps extends EcsServiceProps {
  database: rds.ServerlessCluster
}

export class ListAdoptionsService extends EcsService {

  constructor(scope: cdk.Construct, id: string, props: ListAdoptionServiceProps  ) {
    super(scope, id, props);

    props.database.secret?.grantRead(this.taskDefinition.taskRole);
  }

  containerImageFromRepository(repositoryURI: string) : ecs.ContainerImage {
    return ecs.ContainerImage.fromRegistry(`${repositoryURI}/pet-listadoptions:latest`)
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromAsset("./resources/microservices/petlistadoptions-go", {
      repositoryName: "pet-listadoptions"
    })
  }
}
