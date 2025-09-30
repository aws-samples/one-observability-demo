import { IRole, Role } from 'aws-cdk-lib/aws-iam';
import { Microservice, MicroserviceProperties } from './microservice';
import { ContainerDefinition, Ec2TaskDefinition, FargateTaskDefinition, TaskDefinition, BaseService } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedServiceBase } from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';
import { IPrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { OpenSearchCollection } from './opensearch-collection';
import { OpenSearchPipeline } from './opensearch-pipeline';
export interface EcsServiceProperties extends MicroserviceProperties {
    cpu: number;
    memoryLimitMiB: number;
    desiredTaskCount: number;
    cloudMapNamespace?: IPrivateDnsNamespace;
    openSearchCollection?: OpenSearchCollection | {
        collectionArn: string;
        collectionEndpoint: string;
    };
    /**
     * OpenSearch ingestion pipeline for log routing
     * When provided, logs will be sent to the pipeline instead of directly to OpenSearch
     * Mutually exclusive with openSearchCollection
     */
    openSearchPipeline?: OpenSearchPipeline | {
        pipelineEndpoint: string;
        pipelineArn?: string;
        pipelineRoleArn?: string;
    };
    additionalEnvironment?: {
        [key: string]: string;
    };
    /**
     * Enable CloudWatch agent sidecar for application signals and OTLP traces
     * When enabled, adds a CloudWatch agent container that listens on port 4317
     */
    enableCloudWatchAgent?: boolean;
}
export declare abstract class EcsService extends Microservice {
    readonly taskDefinition: TaskDefinition;
    readonly loadBalancedService?: ApplicationLoadBalancedServiceBase;
    readonly service?: BaseService;
    readonly container: ContainerDefinition;
    readonly taskRole: IRole;
    constructor(scope: Construct, id: string, properties: EcsServiceProperties);
    configureEKSService(): void;
    configureECSService(properties: EcsServiceProperties): {
        taskDefinition: Ec2TaskDefinition | FargateTaskDefinition;
        loadBalancedService: ApplicationLoadBalancedServiceBase | undefined;
        service: BaseService | undefined;
        container: ContainerDefinition;
        taskRole: Role;
    };
    private createFireLensLogDriver;
    private addFireLensLogRouter;
    private addCloudWatchAgentSidecar;
}
