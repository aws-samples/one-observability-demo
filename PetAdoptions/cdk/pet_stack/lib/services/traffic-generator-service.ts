import * as ecs from 'aws-cdk-lib/aws-ecs';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { EcsService, EcsServiceProps } from './ecs-service'
import { Construct } from 'constructs'

export class TrafficGeneratorService extends EcsService {

  constructor(scope: Construct, id: string, props: EcsServiceProps  ) {
    super(scope, id, props);
  }

  containerImageFromRepository(repositoryURI: string) : ecs.ContainerImage {
    return ecs.ContainerImage.fromRegistry(`${repositoryURI}/pet-trafficgenerator:latest`)
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromDockerImageAsset(new DockerImageAsset(this, "traffic-generator", {
      directory: "./resources/microservices/trafficgenerator/trafficgenerator"
    }))
  }
}
