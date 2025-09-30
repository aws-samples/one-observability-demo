import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Microservice } from '../constructs/microservice';
import { ComputeType, HostType } from '../../bin/environment';
import { WorkshopLambdaFunctionProperties } from '../constructs/lambda';
import { WorkshopCanaryProperties } from '../constructs/canary';
export interface MicroserviceApplicationPlacement {
    hostType: HostType;
    computeType: ComputeType;
    disableService: boolean;
    manifestPath?: string;
}
export interface MicroserviceApplicationsProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: {
        [key: string]: string;
    };
    microservicesPlacement: Map<string, MicroserviceApplicationPlacement>;
    lambdaFunctions: Map<string, WorkshopLambdaFunctionProperties>;
    canaries: Map<string, WorkshopCanaryProperties>;
}
export declare class MicroservicesStage extends Stage {
    stack: MicroservicesStack;
    constructor(scope: Construct, id: string, properties: MicroserviceApplicationsProperties);
}
export declare class MicroservicesStack extends Stack {
    microservices: Map<string, Microservice>;
    constructor(scope: Construct, id: string, properties: MicroserviceApplicationsProperties);
    private importResources;
    private createMicroservices;
    private createCanariesAndLambdas;
}
