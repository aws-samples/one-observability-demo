import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as rds from '@aws-cdk/aws-rds';
import { EcsService, EcsServiceProps } from './ecs-service'

export interface PayForAdoptionServiceProps extends EcsServiceProps {
  database: rds.DatabaseInstance
}

export class PayForAdoptionService extends EcsService {

  constructor(scope: cdk.Construct, id: string, props: PayForAdoptionServiceProps) {
    super(scope, id, props);

    props.database.secret?.grantRead(this.taskDefinition.taskRole);
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromAsset("../../payforadoption-go", {
      repositoryName: "pet-pay-for-adoption"
    })
  }
}