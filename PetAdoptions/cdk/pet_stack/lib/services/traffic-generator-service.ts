import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import { EcsService, EcsServiceProps } from './ecs-service'

export class TrafficGeneratorService extends EcsService {

  constructor(scope: cdk.Construct, id: string, props: EcsServiceProps  ) {
    super(scope, id, props);
  }

  containerImageFromRepository(repositoryURI: string) : ecs.ContainerImage {
    return ecs.ContainerImage.fromRegistry(`${repositoryURI}/pet-trafficgenerator:latest`)
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromAsset("./resources/microservices/trafficgenerator/trafficgenerator", {
      repositoryName: "pet-trafficgenerator"
    })
  }
}
