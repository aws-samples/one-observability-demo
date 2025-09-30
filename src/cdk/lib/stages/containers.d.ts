import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
/**
 * Definition for an application to be built and deployed
 */
export interface ContainerDefinition {
    /** The name of the application */
    name: string;
    /** Path to the Dockerfile for building the application */
    dockerFilePath: string;
}
/**
 * Properties for S3 source configuration
 */
export interface S3SourceProperties {
    /** Name of the S3 bucket containing source code */
    bucketName: string;
    /** Key/path to the source code object in S3 */
    bucketKey: string;
}
/**
 * Properties for the Containers Pipeline Stage
 */
export interface ContainersPipelineStageProperties extends StackProps {
    /** S3 source configuration */
    source: S3SourceProperties;
    /** List of applications to build and deploy */
    applicationList: ContainerDefinition[];
}
/**
 * CDK Stage for the Containers Pipeline
 */
export declare class ContainersPipelineStage extends Stage {
    /**
     * Creates a new Containers Pipeline Stage
     * @param scope - The scope in which to define this construct
     * @param id - The scoped construct ID
     * @param properties - Configuration properties for the stage
     */
    constructor(scope: Construct, id: string, properties?: ContainersPipelineStageProperties);
}
/**
 * Stack containing the containers build pipeline and ECR repositories
 */
export declare class ContainersStack extends Stack {
    /** Map of application names to their ECR repositories */
    applicationRepositories: Map<string, Repository>;
    /** The CodePipeline for building applications */
    pipeline: Pipeline;
    /**
     * Creates a new Containers Stack
     * @param scope - The scope in which to define this construct
     * @param id - The scoped construct ID
     * @param properties - Configuration properties for the stack
     * @throws Error when source or applicationList properties are missing
     */
    constructor(scope: Construct, id: string, properties?: ContainersPipelineStageProperties);
}
