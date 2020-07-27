import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as rds from '@aws-cdk/aws-rds';
import { EcsService, EcsServiceProps } from './ecs-service'

export interface ListAdoptionServiceProps extends EcsServiceProps {
  database: rds.DatabaseInstance
} 

export class ListAdoptionsService extends EcsService {

  constructor(scope: cdk.Construct, id: string, props: ListAdoptionServiceProps  ) {
    super(scope, id, props);

    props.database.secret?.grantRead(this.taskDefinition.taskRole);
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromAsset("../../petlistadoptions/petlistadoptions", {
      repositoryName: "pet-list-adoption"
    })
  }
}