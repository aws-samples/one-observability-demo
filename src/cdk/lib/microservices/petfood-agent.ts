/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import * as cdk from 'aws-cdk-lib';
// CodeBuild not needed - builds handled by main containers pipeline
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
// Note: BedrockAgentCore L2 constructs may not be available in all CDK versions
// Using L1 constructs (CfnResource) as fallback
import { Construct } from 'constructs';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';

export interface PetFoodAgentProperties {
  readonly searchApiUrl: string;
  readonly petFoodApiUrl: string;
  readonly parameterStorePrefix?: string;
  readonly ecrRepositoryUri?: string; // ECR repository URI from containers pipeline
}

export class PetFoodAgentConstruct extends Construct {
  public readonly agentRuntime: cdk.CfnResource;
  private readonly ecrRepositoryUri: string;

  constructor(scope: Construct, id: string, props: PetFoodAgentProperties) {
    super(scope, id);

    const parameterStorePrefix = props.parameterStorePrefix || PARAMETER_STORE_PREFIX;
    
    // ECR repository URI - should be provided from the containers pipeline
    this.ecrRepositoryUri = props.ecrRepositoryUri || `${cdk.Stack.of(this).account}.dkr.ecr.${cdk.Stack.of(this).region}.amazonaws.com/petfoodagent-strands-py:latest`;

    // Create SSM Parameters for API URLs (if they don't exist)
    new ssm.StringParameter(this, 'SearchApiUrlParameter', {
      parameterName: `${parameterStorePrefix}/searchapiurl`,
      stringValue: props.searchApiUrl,
      description: 'Search API URL for pet food agent',
    });

    new ssm.StringParameter(this, 'PetFoodApiUrlParameter', {
      parameterName: `${parameterStorePrefix}/petfoodapiurl`,
      stringValue: props.petFoodApiUrl,
      description: 'Pet Food API URL for pet food agent',
    });

    // Create IAM role for Agent Runtime
    const agentRuntimeRole = new iam.Role(this, 'AgentRuntimeRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
      inlinePolicies: {
        AgentRuntimePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter',
                'ssm:GetParameters',
              ],
              resources: [
                `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter${parameterStorePrefix}/*`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Create Agent Runtime using L1 construct (CloudFormation resource)
    this.agentRuntime = new cdk.CfnResource(this, 'PetFoodAgentRuntime', {
      type: 'AWS::BedrockAgentCore::AgentRuntime',
      properties: {
        AgentRuntimeName: 'petfoodagent-strands-py-runtime',
        AgentRuntimeRoleArn: agentRuntimeRole.roleArn,
        ContainerConfiguration: {
          ImageUri: this.ecrRepositoryUri,
        },
        Description: 'Pet Food Recommendation Agent using Strands SDK and Bedrock AgentCore',
        Tags: [
          {
            Key: 'Application',
            Value: 'PetFoodAgent',
          },
          {
            Key: 'Framework',
            Value: 'Strands',
          },
          {
            Key: 'Runtime',
            Value: 'BedrockAgentCore',
          },
        ],
      },
    });

    // Apply NAG suppressions

    NagSuppressions.addResourceSuppressions(
      agentRuntimeRole,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Managed Policies are acceptable for the Agent Runtime role',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Permissions are acceptable for the Agent Runtime role',
        },
      ],
      true,
    );

    // Create outputs
    this.createOutputs(parameterStorePrefix);

    // Tag the construct
    Utilities.TagConstruct(this, {
      'app:owner': 'petstore',
      'app:project': 'workshop',
      'app:name': 'petfoodagent-strands-py',
      'app:computeType': 'bedrock-agentcore',
      'app:hostType': 'managed',
    });
  }

  private createOutputs(parameterStorePrefix: string): void {
    // Create SSM parameters for the agent runtime information
    Utilities.createSsmParameters(
      this,
      parameterStorePrefix,
      new Map(
        Object.entries({
          [SSM_PARAMETER_NAMES.PETFOOD_AGENT_RUNTIME_ARN]: this.agentRuntime.getAtt('AgentRuntimeArn').toString(),
          [SSM_PARAMETER_NAMES.PETFOOD_AGENT_RUNTIME_ID]: this.agentRuntime.getAtt('AgentRuntimeId').toString(),
          [SSM_PARAMETER_NAMES.PETFOOD_AGENT_ECR_URI]: this.ecrRepositoryUri,
        }),
      ),
    );

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'ECRRepositoryUri', {
      value: this.ecrRepositoryUri,
      description: 'ECR Repository URI for Pet Food Agent',
    });

    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: this.agentRuntime.getAtt('AgentRuntimeArn').toString(),
      description: 'Agent Runtime ARN',
    });

    new cdk.CfnOutput(this, 'AgentRuntimeId', {
      value: this.agentRuntime.getAtt('AgentRuntimeId').toString(),
      description: 'Agent Runtime ID',
    });
  }
}