import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import { EcsService, EcsServiceProps } from './ecs-service'

export class SearchService extends EcsService {

  constructor(scope: cdk.Construct, id: string, props: EcsServiceProps  ) {
    super(scope, id, props);

    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonDynamoDBReadOnlyAccess', 'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess'));
    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonS3ReadOnlyAccess', 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'));
  }

  createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromAsset("../../petsearch/petsearch", {
      repositoryName: "pet-search"
    })
  }
}