/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Canary Stack for the One Observability Workshop.
 *
 * This construct deploys a complete canary monitoring system including:
 * - Main application canary for user journey monitoring
 * - Housekeeping canary for demo reset operations
 * - Traffic generation Lambda functions
 * - EventBridge scheduling rules
 * - S3 buckets for canary artifacts
 *
 * @packageDocumentation
 */

import { CfnOutput, Duration, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as synthetics from 'aws-cdk-lib/aws-synthetics';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';

/**
 * Properties for configuring the Canary Stack.
 */
export interface CanaryStackProps extends StackProps {
  /** Whether to enable traffic generation (default: true) */
  enableTrafficGeneration?: boolean;
  /** Number of concurrent users for main canary (default: 50) */
  mainConcurrentUsers?: number;
  /** Number of concurrent users for housekeeping canary (default: 20) */
  housekeepingConcurrentUsers?: number;
  /** Schedule for main canary (default: "rate(1 minute)") */
  mainSchedule?: string;
  /** Schedule for housekeeping canary (default: "rate(5 minutes)") */
  housekeepingSchedule?: string;
  /** Removal policy for resources (default: RETAIN) */
  removalPolicy?: RemovalPolicy;
}

/**
 * Canary Stack that deploys monitoring and traffic generation tools.
 *
 * This stack creates:
 * - S3 bucket for canary artifacts
 * - Main application canary with traffic generation
 * - Housekeeping canary for demo operations
 * - EventBridge rules for scheduling
 * - Lambda functions for traffic generation
 */
export class CanaryStack extends Stack {
  /**
   * Creates a new Canary Stack.
   *
   * @param scope - The parent construct
   * @param id - The construct identifier
   * @param properties - Configuration properties for the stack
   */
  constructor(scope: Construct, id: string, properties: CanaryStackProps = {}) {
    super(scope, id, properties);

    // Configuration with defaults
    const enableTrafficGeneration = properties.enableTrafficGeneration ?? true;
    const mainConcurrentUsers = properties.mainConcurrentUsers ?? 50;
    const housekeepingConcurrentUsers = properties.housekeepingConcurrentUsers ?? 20;
    const mainSchedule = properties.mainSchedule ?? 'rate(1 minute)';
    const housekeepingSchedule = properties.housekeepingSchedule ?? 'rate(5 minutes)';

    // Get region and account for resource naming
    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    // Create S3 bucket for canary artifacts
    const canaryArtifactsBucket = new s3.Bucket(this, 'CanaryArtifactsBucket', {
      bucketName: `petsite-canary-artifacts-${account}-${region}-dev-${Math.random().toString(36).substring(2, 8)}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: properties.removalPolicy,
    });

    // Create IAM role for main canary
    const mainCanaryRole = new iam.Role(this, 'MainCanaryRole', {
      roleName: `petsite-main-canary-role-${region}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant SSM parameter access to main canary
    mainCanaryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: ['*'],
    }));

    // Grant S3 access to main canary
    canaryArtifactsBucket.grantReadWrite(mainCanaryRole);

    // Create main canary
    const mainCanary = new synthetics.Canary(this, 'MainCanary', {
      canaryName: `petsite-main-canary-${region}`,
      schedule: synthetics.Schedule.expression(mainSchedule),
      test: synthetics.Test.custom({
        handler: 'index.handler',
        code: synthetics.Code.fromInline(this.getMainCanaryCode()),
      }),
      artifactsBucketLocation: {
        bucket: canaryArtifactsBucket,
        prefix: 'main-artifacts/',
      },
      role: mainCanaryRole,
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_7_0,
      startAfterCreation: true,
      timeToLive: Duration.minutes(5),
    });

    // Create main traffic generator Lambda
    const mainTrafficGeneratorFunction = new lambda.Function(this, 'MainTrafficGeneratorFunction', {
      functionName: `petsite-main-traffic-generator-${region}`,
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(this.getMainTrafficGeneratorCode()),
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        CANARY_FUNCTION_ARN: mainCanary.role!.roleArn,
        CONCURRENT_USERS: mainConcurrentUsers.toString(),
      },
    });

    // Grant Lambda invoke permissions to main traffic generator
    mainTrafficGeneratorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: ['*'],
    }));

    // Create EventBridge rule for main traffic generation
    const mainTrafficScheduleRule = new events.Rule(this, 'MainTrafficScheduleRule', {
      ruleName: `petsite-main-traffic-generator-schedule-${region}`,
      schedule: events.Schedule.expression(mainSchedule),
      description: `Triggers main traffic generator Lambda every minute to invoke main canary ${mainConcurrentUsers} times`,
      targets: [new targets.LambdaFunction(mainTrafficGeneratorFunction)],
    });

    // Create IAM role for housekeeping canary
    const housekeepingCanaryRole = new iam.Role(this, 'HousekeepingCanaryRole', {
      roleName: `petsite-housekeeping-canary-role-${region}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant SSM parameter access to housekeeping canary
    housekeepingCanaryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: ['*'],
    }));

    // Grant S3 access to housekeeping canary
    canaryArtifactsBucket.grantReadWrite(housekeepingCanaryRole);

    // Create housekeeping canary
    const housekeepingCanary = new synthetics.Canary(this, 'HousekeepingCanary', {
      canaryName: `petsite-housekeeping-canary-${region}`,
      schedule: synthetics.Schedule.expression(housekeepingSchedule),
      test: synthetics.Test.custom({
        handler: 'index.handler',
        code: synthetics.Code.fromInline(this.getHousekeepingCanaryCode()),
      }),
      artifactsBucketLocation: {
        bucket: canaryArtifactsBucket,
        prefix: 'housekeeping-artifacts/',
      },
      role: housekeepingCanaryRole,
      runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_7_0,
      startAfterCreation: true,
      timeToLive: Duration.minutes(5),
    });

    // Create housekeeping traffic generator Lambda
    const housekeepingTrafficGeneratorFunction = new lambda.Function(this, 'HousekeepingTrafficGeneratorFunction', {
      functionName: `petsite-housekeeping-traffic-generator-${region}`,
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(this.getHousekeepingTrafficGeneratorCode()),
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        CANARY_FUNCTION_ARN: housekeepingCanary.role!.roleArn,
        CONCURRENT_USERS: housekeepingConcurrentUsers.toString(),
      },
    });

    // Grant Lambda invoke permissions to housekeeping traffic generator
    housekeepingTrafficGeneratorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: ['*'],
    }));

    // Create EventBridge rule for housekeeping traffic generation
    const housekeepingTrafficScheduleRule = new events.Rule(this, 'HousekeepingTrafficScheduleRule', {
      ruleName: `petsite-housekeeping-traffic-generator-schedule-${region}`,
      schedule: events.Schedule.expression(housekeepingSchedule),
      description: `Triggers housekeeping traffic generator Lambda every 5 minutes to invoke housekeeping canary ${housekeepingConcurrentUsers} times`,
      targets: [new targets.LambdaFunction(housekeepingTrafficGeneratorFunction)],
    });

    // CloudFormation outputs
    new CfnOutput(this, 'MainCanaryName', {
      value: mainCanary.canaryName,
      description: 'Name of the main petsite canary',
    });

    new CfnOutput(this, 'MainCanaryRoleArn', {
      value: mainCanary.role!.roleArn,
      description: 'ARN of the main canary execution role',
    });

    new CfnOutput(this, 'MainTrafficGeneratorFunctionName', {
      value: mainTrafficGeneratorFunction.functionName,
      description: 'Name of the main traffic generator Lambda function',
    });

    new CfnOutput(this, 'MainTrafficScheduleRuleName', {
      value: mainTrafficScheduleRule.ruleName,
      description: 'Name of the main traffic generation EventBridge rule',
    });

    new CfnOutput(this, 'HousekeepingCanaryName', {
      value: housekeepingCanary.canaryName,
      description: 'Name of the housekeeping canary',
    });

    new CfnOutput(this, 'HousekeepingCanaryRoleArn', {
      value: housekeepingCanary.role!.roleArn,
      description: 'ARN of the housekeeping canary execution role',
    });

    new CfnOutput(this, 'HousekeepingTrafficGeneratorFunctionName', {
      value: housekeepingTrafficGeneratorFunction.functionName,
      description: 'Name of the housekeeping traffic generator Lambda function',
    });

    new CfnOutput(this, 'HousekeepingTrafficScheduleRuleName', {
      value: housekeepingTrafficScheduleRule.ruleName,
      description: 'Name of the housekeeping traffic generation EventBridge rule',
    });

    new CfnOutput(this, 'CanaryArtifactsBucketName', {
      value: canaryArtifactsBucket.bucketName,
      description: 'Name of the S3 bucket for canary artifacts',
    });
  }

  /**
   * Generates the main canary code for monitoring the petsite application.
   */
  private getMainCanaryCode(): string {
    return `
var synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const recordedScript = async function () {
  let page = await synthetics.getPage();
  
  const navigationPromise = page.waitForNavigation()
  
  // Try to read from SSM, fallback to environment variable
  let petsiteUrl = process.env.PETSITE_URL;
  const ssmParameterName = process.env.SSM_PARAMETER_NAME || '/petstore/petsiteurl';
  
  // Attempt to read from SSM if AWS SDK is available
  try {
    if (typeof AWS !== 'undefined') {
      const ssm = new AWS.SSM();
      const parameter = await ssm.getParameter({
        Name: ssmParameterName,
        WithDecryption: false
      }).promise();
      
      if (parameter.Parameter && parameter.Parameter.Value) {
        petsiteUrl = parameter.Parameter.Value;
        log.info('Successfully retrieved petsite URL from SSM: ' + petsiteUrl);
      }
    } else {
      log.info('AWS SDK not available, using environment variable URL: ' + petsiteUrl);
    }
  } catch (error) {
    log.info('SSM access failed, using environment variable URL: ' + petsiteUrl);
  }
  
  log.info('Starting main canary execution with URL: ' + petsiteUrl);
  log.info('SSM Parameter to monitor: ' + ssmParameterName);
  
  try {
    await synthetics.executeStep('Goto_0', async function() {
      await page.goto(petsiteUrl + '/?userId=user1930', {waitUntil: 'domcontentloaded', timeout: 60000})
    })
    
    await page.setViewport({ width: 1463, height: 863 })
    
    await synthetics.executeStep('Click_1', async function() {
      await page.waitForSelector('.pet-header #performhousekeeping')
      await page.click('.pet-header #performhousekeeping')
    })
    
    await navigationPromise
    
    log.info('Main canary execution completed successfully');
  } catch (error) {
    log.error('Main canary execution failed: ' + error.message);
    throw error;
  }
};
exports.handler = async () => {
    return await recordedScript();
};
`;
  }

  /**
   * Generates the housekeeping canary code for demo reset operations.
   */
  private getHousekeepingCanaryCode(): string {
    return `
var synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const recordedScript = async function () {
  let page = await synthetics.getPage();

  const navigationPromise = page.waitForNavigation()

  // Try to read from SSM, fallback to environment variable
  let petsiteUrl = process.env.PETSITE_URL || 'https://d1cz8gv1106ws7.cloudfront.net';
  const ssmParameterName = process.env.SSM_PARAMETER_NAME || '/petstore/petsiteurl';

  // Attempt to read from SSM if AWS SDK is available
  try {
    if (typeof AWS !== 'undefined') {
      const ssm = new AWS.SSM();
      const parameter = await ssm.getParameter({
        Name: ssmParameterName,
        WithDecryption: false
      }).promise();

      if (parameter.Parameter && parameter.Parameter.Value) {
        petsiteUrl = parameter.Parameter.Value;
        log.info('Successfully retrieved petsite URL from SSM: ' + petsiteUrl);
      }
    } else {
      log.info('AWS SDK not available, using environment variable URL: ' + petsiteUrl);
    }
  } catch (error) {
    log.info('SSM access failed, using environment variable URL: ' + petsiteUrl);
  }

  log.info('Starting housekeeping canary execution with URL: ' + petsiteUrl);
  log.info('SSM Parameter to monitor: ' + ssmParameterName);

  try {
    await synthetics.executeStep('Goto_0', async function() {
      await page.goto(petsiteUrl + '/?userId=housekeeping1930', {waitUntil: 'domcontentloaded', timeout: 60000})
    })

    await page.setViewport({ width: 1463, height: 863 })

    // Wait for page to load completely
    await page.waitForSelector('.pet-header', { timeout: 10000 });

    await synthetics.executeStep('Click_Housekeeping', async function() {
      await page.waitForSelector('.pet-header #performhousekeeping')
      await page.click('.pet-header #performhousekeeping')
    })

    await navigationPromise

    // Wait for housekeeping to complete
    await page.waitForTimeout(2000);

    log.info('Housekeeping canary execution completed successfully');
  } catch (error) {
    log.error('Housekeeping canary execution failed: ' + error.message);
    throw error;
  }
};
exports.handler = async () => {
    return await recordedScript();
};
`;
  }

  /**
   * Generates the main traffic generator Lambda code.
   */
  private getMainTrafficGeneratorCode(): string {
    return `
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

exports.handler = async (event) => {
  const concurrentUsers = parseInt(process.env.CONCURRENT_USERS || '50', 10);

  console.log(\`🚀 Starting main traffic generation for \${concurrentUsers} concurrent users...\`);
  console.log(\`📅 Event: \${JSON.stringify(event)}\`);

  // Find the main canary function dynamically
  const canaryFunctionName = await findMainCanaryFunction();

  if (!canaryFunctionName) {
    throw new Error('Could not find main canary Lambda function');
  }

  console.log(\`🎯 Found main canary function: \${canaryFunctionName}\`);

  const invokePromises = [];
  const startTime = Date.now();

  for (let i = 0; i < concurrentUsers; i++) {
    const userId = \`user\${String(i).padStart(4, '0')}\`;
    const payload = {
      userId: userId,
      timestamp: new Date().toISOString(),
      trafficGenerator: true,
    };

    invokePromises.push(
      lambda.invoke({
        FunctionName: canaryFunctionName,
        InvocationType: 'Event', // Asynchronous invocation
        Payload: JSON.stringify(payload),
      }).promise().then(result => {
        console.log(\`✅ Invoked main canary for user \${userId}\`);
        return { userId, success: true, result };
      }).catch(error => {
        console.error(\`❌ Failed to invoke main canary for user \${userId}: \${error.message}\`);
        return { userId, success: false, error: error.message };
      })
    );
  }

  try {
    const results = await Promise.all(invokePromises);
    const endTime = Date.now();
    const duration = endTime - startTime;

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(\`🎉 Main traffic generation completed!\`);
    console.log(\`📊 Results: \${successful} successful, \${failed} failed\`);
    console.log(\`⏱️  Duration: \${duration}ms\`);
    console.log(\`🚀 Generated \${concurrentUsers} concurrent user sessions\`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Main traffic generation completed',
        concurrentUsers,
        successful,
        failed,
        duration,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('❌ Error in main traffic generation:', error);
    throw error;
  }
};

async function findMainCanaryFunction() {
  try {
    const response = await lambda.listFunctions().promise();
    const canaryFunction = response.Functions.find(func =>
      func.FunctionName.startsWith('cwsyn-') && func.FunctionName.includes('main')
    );

    return canaryFunction ? canaryFunction.FunctionName : null;
  } catch (error) {
    console.error('Error finding main canary function:', error);
    return null;
  }
}
`;
  }

  /**
   * Generates the housekeeping traffic generator Lambda code.
   */
  private getHousekeepingTrafficGeneratorCode(): string {
    return `
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

exports.handler = async (event) => {
  const concurrentUsers = parseInt(process.env.CONCURRENT_USERS || '20', 10);

  console.log(\`🧹 Starting housekeeping traffic generation for \${concurrentUsers} concurrent users...\`);
  console.log(\`📅 Event: \${JSON.stringify(event)}\`);

  // Find the housekeeping canary function dynamically
  const canaryFunctionName = await findHousekeepingCanaryFunction();

  if (!canaryFunctionName) {
    throw new Error('Could not find housekeeping canary Lambda function');
  }

  console.log(\`🎯 Found housekeeping canary function: \${canaryFunctionName}\`);

  const invokePromises = [];
  const startTime = Date.now();

  for (let i = 0; i < concurrentUsers; i++) {
    const userId = \`housekeeping\${String(i).padStart(4, '0')}\`;
    const payload = {
      userId: userId,
      timestamp: new Date().toISOString(),
      trafficGenerator: true,
      operation: 'housekeeping',
    };

    invokePromises.push(
      lambda.invoke({
        FunctionName: canaryFunctionName,
        InvocationType: 'Event', // Asynchronous invocation
        Payload: JSON.stringify(payload),
      }).promise().then(result => {
        console.log(\`✅ Invoked housekeeping canary for user \${userId}\`);
        return { userId, success: true, result };
      }).catch(error => {
        console.error(\`❌ Failed to invoke housekeeping canary for user \${userId}: \${error.message}\`);
        return { userId, success: false, error: error.message };
      })
    );
  }

  try {
    const results = await Promise.all(invokePromises);
    const endTime = Date.now();
    const duration = endTime - startTime;

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(\`🎉 Housekeeping traffic generation completed!\`);
    console.log(\`📊 Results: \${successful} successful, \${failed} failed\`);
    console.log(\`⏱️  Duration: \${duration}ms\`);
    console.log(\`🧹 Generated \${concurrentUsers} concurrent housekeeping user sessions\`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Housekeeping traffic generation completed',
        concurrentUsers,
        successful,
        failed,
        duration,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('❌ Error in housekeeping traffic generation:', error);
    throw error;
  }
};

async function findHousekeepingCanaryFunction() {
  try {
    const response = await lambda.listFunctions().promise();
    const canaryFunction = response.Functions.find(func =>
      func.FunctionName.startsWith('cwsyn-') && func.FunctionName.includes('housekeeping')
    );

    return canaryFunction ? canaryFunction.FunctionName : null;
  } catch (error) {
    console.error('Error finding housekeeping canary function:', error);
    return null;
  }
}
`;
  }
}
