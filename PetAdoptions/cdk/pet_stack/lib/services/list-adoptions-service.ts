import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { Stack } from 'aws-cdk-lib';
import { EcsService, EcsServiceProps } from './ecs-service'
import { Construct } from 'constructs'


export interface ListAdoptionServiceProps extends EcsServiceProps {
  database: rds.DatabaseCluster
}

export class ListAdoptionsService extends EcsService {

  constructor(scope: Construct, id: string, props: ListAdoptionServiceProps  ) {
    super(scope, id, props);

    props.database.secret?.grantRead(this.taskDefinition.taskRole);
    
    // Add environment variables for the Python service
    this.container.addEnvironment('PORT', '8080');
    this.container.addEnvironment('WORKERS', '4');
    this.container.addEnvironment('AWS_REGION', Stack.of(this).region);
  }

  containerImageFromRepository(repositoryURI: string) : ecs.ContainerImage {
    return ecs.ContainerImage.fromRegistry(`${repositoryURI}/pet-listadoptions:latest`)
  }

    createContainerImage() : ecs.ContainerImage {
    return ecs.ContainerImage.fromDockerImageAsset(new DockerImageAsset(this,"petlistadoptions-python",
    { directory: "../../petlistadoptions-py"}
    ))
  } 
}
