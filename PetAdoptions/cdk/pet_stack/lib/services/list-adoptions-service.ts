import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import { EcsService, EcsServiceProps } from './ecs-service'

export class ListAdoptionsService extends EcsService {

  constructor(scope: cdk.Construct, id: string, props: EcsServiceProps  ) {
    super(scope, id, props);
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromAsset("../../petlistadoptions/petlistadoptions", {
      repositoryName: "pet-list-adoption"
    })
  }
}