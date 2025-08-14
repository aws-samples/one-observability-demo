import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { EcsService, EcsServiceProps } from './ecs-service'
import { Construct } from 'constructs'

export class PetFoodService extends EcsService {

  constructor(scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id, props);

    // Add DynamoDB permissions for PetFoods and PetFoodCarts tables
    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonDynamoDBFullAccess', 'arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess'));
    
    // Add S3 permissions for food images
    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonS3ReadOnlyAccess', 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'));
    
    // Add SSM Parameter Store permissions for configuration and error simulation
    const ssmParameterPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath'
      ],
      resources: [
        `arn:aws:ssm:${props.region}:*:parameter/petstore/*`,
      ]
    });
    this.taskDefinition.taskRole?.addToPrincipalPolicy(ssmParameterPolicy);
  }

  containerImageFromRepository(repositoryURI: string): ecs.ContainerImage {
    return ecs.ContainerImage.fromRegistry(`${repositoryURI}/petfood-rs:latest`)
  }

  createContainerImage(): ecs.ContainerImage {
    return ecs.ContainerImage.fromDockerImageAsset(new DockerImageAsset(this, "petfood-service", {
      directory: "../../petfood-rs"
    }))
  }
}