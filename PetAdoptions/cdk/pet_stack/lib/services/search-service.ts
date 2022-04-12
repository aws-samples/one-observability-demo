import * as cdk from 'aws-cdk-lib/core';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { EcsService, EcsServiceProps } from './ecs-service'
import { Construct } from 'constructs'

export class SearchService extends EcsService {

  constructor(scope: Construct, id: string, props: EcsServiceProps  ) {
    super(scope, id, props);

    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonDynamoDBReadOnlyAccess', 'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess'));
    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonS3ReadOnlyAccess', 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'));
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
