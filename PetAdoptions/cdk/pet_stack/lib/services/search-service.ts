import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as appsignals from '@aws-cdk/aws-applicationsignals-alpha';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { EcsService, EcsServiceProps } from './ecs-service'
import { Construct } from 'constructs'

export class SearchService extends EcsService {

  constructor(scope: Construct, id: string, props: EcsServiceProps  ) {
    super(scope, id, props);

    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonDynamoDBReadOnlyAccess', 'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess'));
    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonS3ReadOnlyAccess', 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'));

    // Add Application Signals integration with CloudWatch agent
    new appsignals.ApplicationSignalsIntegration(this, 'ApplicationSignalsIntegration', {
      taskDefinition: this.taskDefinition,
      instrumentation: {
        sdkVersion: appsignals.JavaInstrumentationVersion.V2_10_0,
      },
      serviceName: 'PetSearch',
      cloudWatchAgentSidecar: {
        containerName: 'ecs-cwagent',
        enableLogging: true,
        cpu: 256,
        memoryLimitMiB: 512,
      }
    });
  }

  containerImageFromRepository(repositoryURI: string) : ecs.ContainerImage {
    return ecs.ContainerImage.fromRegistry(`${repositoryURI}/pet-search-java:latest`)
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromDockerImageAsset(new DockerImageAsset(this,"search-service", {
      directory: "./resources/microservices/petsearch-java"
    }))
  }
}
