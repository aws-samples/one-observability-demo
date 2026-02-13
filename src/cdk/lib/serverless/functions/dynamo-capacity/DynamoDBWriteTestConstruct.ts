import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Properties for the DynamoDB Write Test Lambda function construct
 */
export interface DynamoDBWriteTestConstructProps {
  /**
   * Memory size in MB
   * @default 128
   */
  memorySize?: number;
  
  /**
   * Timeout duration
   * @default 2 seconds
   */
  timeout?: cdk.Duration;
  
  /**
   * Log retention period
   * @default 3 days
   */
  logRetention?: logs.RetentionDays;
  
  /**
   * Additional environment variables
   * @default none
   */
  environment?: { [key: string]: string };
}

/**
 * CDK Construct for DynamoDB Write Capacity Test Lambda Function
 * 
 * This construct creates a Lambda function that tests DynamoDB write capacity
 * by writing configurable-sized items and measuring consumed WCUs.
 * 
 * Note: DynamoDB permissions are intentionally NOT included in this construct.
 * They should be added separately for workshop/troubleshooting scenarios.
 */
export class DynamoDBWriteTestConstruct extends Construct {
  /**
   * The Lambda function
   */
  public readonly function: lambda.Function;
  
  /**
   * The IAM role for the Lambda function
   */
  public readonly role: iam.Role;
  
  constructor(scope: Construct, id: string, props?: DynamoDBWriteTestConstructProps) {
    super(scope, id);
    
    // Create IAM role for Lambda function
    // Only includes basic execution permissions (CloudWatch Logs)
    // DynamoDB permissions intentionally omitted for workshop scenarios
    this.role = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for DynamoDB Write Capacity Test Lambda',
      managedPolicies: [
        // Basic Lambda execution permissions (CloudWatch Logs)
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    
    // Create the Lambda function
    this.function = new lambda.Function(this, 'Function', {
      functionName: 'DynamoDBWriteCapacityTest',
      runtime: lambda.Runtime.PYTHON_3_12, // Python 3.14 not yet available, using 3.12
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset('src/applications/lambda/dynamodb-write-test-python'),
      role: this.role,
      memorySize: props?.memorySize || 128,
      timeout: props?.timeout || cdk.Duration.seconds(2),
      environment: {
        ...props?.environment,
      },
      // X-Ray tracing disabled per requirements
      tracing: lambda.Tracing.DISABLED,
      // Set log retention to 3 days
      logRetention: props?.logRetention || logs.RetentionDays.THREE_DAYS,
      description: 'Tests DynamoDB write capacity - for workshop troubleshooting scenarios',
    });
    
    // Add tags for resource organization
    cdk.Tags.of(this.function).add('Application', 'OneObservability');
    cdk.Tags.of(this.function).add('Component', 'DynamoDBWriteTest');
    cdk.Tags.of(this.function).add('ManagedBy', 'CDK');
    cdk.Tags.of(this.function).add('Purpose', 'Workshop');
    
    // Create CloudFormation outputs
    new cdk.CfnOutput(this, 'FunctionName', {
      value: this.function.functionName,
      description: 'Name of the DynamoDB Write Test Lambda function',
      exportName: `${cdk.Stack.of(this).stackName}-DynamoDBWriteTestFunctionName`,
    });
    
    new cdk.CfnOutput(this, 'FunctionArn', {
      value: this.function.functionArn,
      description: 'ARN of the DynamoDB Write Test Lambda function',
      exportName: `${cdk.Stack.of(this).stackName}-DynamoDBWriteTestFunctionArn`,
    });
    
    new cdk.CfnOutput(this, 'RoleName', {
      value: this.role.roleName,
      description: 'IAM role name for the Lambda function (add DynamoDB permissions here)',
      exportName: `${cdk.Stack.of(this).stackName}-DynamoDBWriteTestRoleName`,
    });
  }
}
