/**
 * CDK Pipeline module for the One Observability Workshop.
 *
 * This module defines the main CI/CD pipeline that deploys the workshop infrastructure
 * across multiple stages including core networking, applications, storage, compute, and microservices.
 *
 * @packageDocumentation
 */
import { Stack, StackProps } from 'aws-cdk-lib';
import { IRole } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { CoreStageProperties } from './stages/core';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ContainerDefinition } from './stages/containers';
import { AuroraPostgresEngineVersion } from 'aws-cdk-lib/aws-rds';
import { MicroserviceApplicationsProperties } from './stages/applications';
/**
 * Properties for configuring the CDK Pipeline stack.
 *
 * This interface extends StackProps and includes all necessary configuration
 * for deploying the One Observability Workshop infrastructure pipeline.
 */
export interface CDKPipelineProperties extends StackProps {
    /** S3 bucket name containing the source code repository */
    configBucketName: string;
    /** Git branch name to deploy from */
    branchName: string;
    /** Organization name for resource naming */
    organizationName: string;
    /** Repository name for the source code */
    repositoryName: string;
    /** Working folder path within the repository */
    workingFolder: string;
    /** Optional tags to apply to all resources */
    tags?: {
        [key: string]: string;
    };
    /** Optional properties for the core infrastructure stage */
    coreStageProperties?: CoreStageProperties;
    /** Default log retention period for CloudWatch logs */
    defaultRetentionPeriod?: RetentionDays;
    /** List of container application definitions to deploy */
    applicationList: ContainerDefinition[];
    /** Paths to pet store images for seeding the application */
    petImagesPaths: string[];
    /** PostgreSQL engine version for Aurora database */
    postgresEngineVersion?: AuroraPostgresEngineVersion;
    /** Properties for microservices deployment stage */
    microservicesProperties: MicroserviceApplicationsProperties;
}
/**
 * CDK Pipeline stack for the One Observability Workshop.
 *
 * This stack creates a complete CI/CD pipeline that deploys the workshop infrastructure
 * in multiple stages:
 * - Core: Networking, security, and foundational services
 * - Applications: Container-based applications (ECS/EKS)
 * - Backend: Storage (S3, Aurora, DynamoDB) and compute (Lambda, EC2)
 * - Microservices: Sample microservices for the pet store application
 *
 * The pipeline uses AWS CodePipeline with CodeBuild for synthesis and deployment,
 * with proper security controls and artifact management.
 */
export declare class CDKPipeline extends Stack {
    /**
     * The IAM role used by the pipeline for executing pipeline actions.
     * This role has permissions to access the source S3 bucket and other required resources.
     */
    readonly pipelineRole: IRole;
    /**
     * Creates a new CDK Pipeline stack.
     *
     * @param scope - The parent construct
     * @param id - The construct identifier
     * @param properties - Configuration properties for the pipeline
     */
    constructor(scope: Construct, id: string, properties: CDKPipelineProperties);
}
