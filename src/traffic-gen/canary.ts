#!/usr/bin/env node

import { App, Stack, StackProps, Tags, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as synthetics from 'aws-cdk-lib/aws-synthetics';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export interface PetsiteCanaryStackProps extends StackProps {
  readonly canaryName?: string;
  readonly ssmParameterName?: string;
  readonly trafficGeneratorFunctionName?: string;
  readonly eventBridgeRuleName?: string;
  readonly artifactsBucketName?: string;
  readonly canaryRoleName?: string;
  readonly concurrentUsers?: number;
  readonly scheduleExpression?: string;
}

class PetsiteCanaryStack extends Stack {
  constructor(scope: Construct, id: string, props: PetsiteCanaryStackProps) {
    super(scope, id, props);

    // Extract configuration with defaults
    const canaryName = props.canaryName || 'petsite-canary';
    const ssmParameterName = props.ssmParameterName || '/petstore/petsiteurl';
    const trafficGeneratorFunctionName = props.trafficGeneratorFunctionName || 'petsite-traffic-generator';
    const eventBridgeRuleName = props.eventBridgeRuleName || 'petsite-traffic-generator-schedule';
    const artifactsBucketName = props.artifactsBucketName || `petsite-canary-artifacts-${this.account}-${this.region}`;
    const canaryRoleName = props.canaryRoleName || `petsite-canary-role-${this.account}-${this.region}`;
    const concurrentUsers = props.concurrentUsers || 50;
    const scheduleExpression = props.scheduleExpression || 'rate(1 minute)';

    // Create a dedicated S3 bucket for canary artifacts
    const artifactsBucket = new s3.Bucket(this, 'CanaryArtifactsBucket', {
      bucketName: artifactsBucketName,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // Reference existing SSM Parameter for the petsite URL
    const parameter = ssm.StringParameter.fromStringParameterName(this, 'PetsiteUrlParameter', ssmParameterName);

    // Create a dedicated IAM role for the canary
    const canaryRole = new iam.Role(this, 'CanaryExecutionRole', {
      roleName: canaryRoleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for petsite canary',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add specific permissions for SSM parameter access
    canaryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
      ],
      resources: [parameter.parameterArn],
    }));

    // Add S3 permissions for artifacts
    canaryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
        's3:GetObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        artifactsBucket.bucketArn,
        `${artifactsBucket.bucketArn}/*`,
      ],
    }));

    // Create the canary
    const canary = new synthetics.Canary(this, 'PetsiteCanary', {
      canaryName: canaryName,
      runtime: new synthetics.Runtime('syn-nodejs-puppeteer-10.0', synthetics.RuntimeFamily.NODEJS),
      schedule: synthetics.Schedule.expression('rate(1 minute)'),
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(this.getCanaryCode()),
        handler: 'index.handler',
      }),
      timeout: Duration.seconds(60),
      environmentVariables: {},
      artifactsBucketLocation: {
        bucket: artifactsBucket,
        prefix: 'canary-artifacts/',
      },
      role: canaryRole,
    });

    // Output important information
    new CfnOutput(this, 'CanaryName', {
      value: canary.canaryName,
      description: 'Name of the created canary',
    });

    new CfnOutput(this, 'ParameterArn', {
      value: parameter.parameterArn,
      description: 'ARN of the SSM parameter containing the petsite URL',
    });

    new CfnOutput(this, 'ArtifactsBucket', {
      value: artifactsBucket.bucketName,
      description: 'S3 bucket for canary artifacts',
    });

    new CfnOutput(this, 'CanaryRoleArn', {
      value: canaryRole.roleArn,
      description: 'ARN of the canary execution role',
    });

    // Create traffic generator Lambda
    const trafficGeneratorFunction = new lambda.Function(this, 'TrafficGeneratorFunction', {
      functionName: trafficGeneratorFunctionName,
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(this.getTrafficGeneratorCode()),
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        CANARY_FUNCTION_ARN: canary.role.node.defaultChild?.toString() || '',
        CONCURRENT_USERS: concurrentUsers.toString(),
      },
    });

    // Grant permissions to invoke the canary Lambda function and list functions
    trafficGeneratorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction', 'lambda:ListFunctions'],
        resources: ['*'], // Need * for ListFunctions, specific ARN for InvokeFunction
      }),
    );

    // Create EventBridge rule to schedule traffic generation every minute
    const trafficScheduleRule = new events.Rule(this, 'TrafficScheduleRule', {
      ruleName: eventBridgeRuleName,
      schedule: events.Schedule.expression(scheduleExpression),
      description: 'Triggers traffic generator Lambda every minute to invoke canary 50 times',
    });

    trafficScheduleRule.addTarget(new targets.LambdaFunction(trafficGeneratorFunction));

    // Output traffic generator information
    new CfnOutput(this, 'TrafficGeneratorFunctionName', {
      value: trafficGeneratorFunction.functionName,
      description: 'Name of the traffic generator Lambda function',
    });

    new CfnOutput(this, 'TrafficScheduleRuleName', {
      value: trafficScheduleRule.ruleName,
      description: 'Name of the EventBridge rule for traffic generation',
    });

    // Apply tags
    Tags.of(this).add('Project', 'OneObservability');
    Tags.of(this).add('Component', 'Canary');
    Tags.of(this).add('Environment', 'Development');
    Tags.of(this).add('Stack', 'StandaloneCanary');
    Tags.of(this).add('Purpose', 'SyntheticMonitoring');
  }

  private getCanaryCode(): string {
    return `
var synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const recordedScript = async function () {
  let page = await synthetics.getPage();
  
  const navigationPromise = page.waitForNavigation()
  
  // Try to read from SSM, fallback to environment variable
  let petsiteUrl = process.env.PETSITE_URL ;
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
  
  log.info('Starting canary execution with URL: ' + petsiteUrl);
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
    
    log.info('Canary execution completed successfully');
  } catch (error) {
    log.error('Canary execution failed: ' + error.message);
    throw error;
  }
};
exports.handler = async () => {
    return await recordedScript();
};
`;
  }

  private getTrafficGeneratorCode(): string {
    return `
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

exports.handler = async (event) => {
  const concurrentUsers = parseInt(process.env.CONCURRENT_USERS || '50', 10);
  
  console.log(\`🚀 Starting traffic generation for \${concurrentUsers} concurrent users...\`);
  console.log(\`📅 Event: \${JSON.stringify(event)}\`);
  
  // Find the canary function dynamically
  const canaryFunctionName = await findCanaryFunction();
  
  if (!canaryFunctionName) {
    throw new Error('Could not find canary Lambda function');
  }
  
  console.log(\`🎯 Found canary function: \${canaryFunctionName}\`);
  
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
        console.log(\`✅ Invoked canary for user \${userId}\`);
        return { userId, success: true, result };
      }).catch(error => {
        console.error(\`❌ Failed to invoke canary for user \${userId}: \${error.message}\`);
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
    
    console.log(\`🎉 Traffic generation completed!\`);
    console.log(\`📊 Results: \${successful} successful, \${failed} failed\`);
    console.log(\`⏱️  Duration: \${duration}ms\`);
    console.log(\`🚀 Generated \${concurrentUsers} concurrent user sessions\`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Traffic generation completed',
        concurrentUsers,
        successful,
        failed,
        duration,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('❌ Error in traffic generation:', error);
    throw error;
  }
};

async function findCanaryFunction() {
  try {
    const response = await lambda.listFunctions().promise();
    const canaryFunction = response.Functions.find(func => 
      func.FunctionName.startsWith('cwsyn-')
    );
    
    return canaryFunction ? canaryFunction.FunctionName : null;
  } catch (error) {
    console.error('Error finding canary function:', error);
    return null;
  }
}
`;
  }
}

const app = new App();

// Get region from environment or default to us-east-1
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

new PetsiteCanaryStack(app, 'PetsiteCanaryStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  description: `Standalone canary stack for petsite monitoring in ${region}`,
  // Optional: Override default names for this deployment
  canaryName: `petsite-canary-${region}`,
  trafficGeneratorFunctionName: `petsite-traffic-generator-${region}`,
  eventBridgeRuleName: `petsite-traffic-generator-schedule-${region}`,
  artifactsBucketName: `petsite-canary-artifacts-${process.env.CDK_DEFAULT_ACCOUNT}-${region}`,
  canaryRoleName: `petsite-canary-role-${process.env.CDK_DEFAULT_ACCOUNT}-${region}`,
});

app.synth();
