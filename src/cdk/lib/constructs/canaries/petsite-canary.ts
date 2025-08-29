import * as cdk from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import * as synthetics from 'aws-cdk-lib/aws-synthetics';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface PetsiteCanaryProps {
  /**
   * The name of the canary
   * @default 'petsite-canary'
   */
  canaryName?: string;
  
  /**
   * The schedule expression for the canary
   * @default 'rate(1 minute)'
   */
  scheduleExpression?: string;
  
  /**
   * The runtime version for the canary
   * @default 'syn-nodejs-puppeteer-10.0'
   */
  runtimeVersion?: string;
  
  /**
   * The timeout for the canary execution
   * @default 60 seconds
   */
  timeout?: cdk.Duration;
  
  /**
   * The retention period for canary artifacts
   * @default 1 day
   */
  retentionPeriod?: cdk.Duration;
  
  /**
   * Whether to enable the canary for traffic generation
   * @default false
   */
  enableTrafficGeneration?: boolean;
  
  /**
   * The number of concurrent users to simulate
   * @default 50
   */
  concurrentUsers?: number;
}

export class PetsiteCanary extends Construct {
  public readonly canary: synthetics.Canary;
  public readonly parameter: ssm.StringParameter;
  public readonly canaryFunctionArn: string;

  constructor(scope: Construct, id: string, props: PetsiteCanaryProps = {}) {
    super(scope, id);

    const {
      canaryName = 'petsite-canary',
      scheduleExpression = 'rate(1 minute)',
      runtimeVersion = 'syn-nodejs-puppeteer-10.0',
      timeout = cdk.Duration.seconds(60),
      retentionPeriod = cdk.Duration.days(1),
      enableTrafficGeneration = false,
      concurrentUsers = 50
    } = props;

    // Create SSM Parameter for the petsite URL (this will use the existing parameter)
    this.parameter = new ssm.StringParameter(this, 'PetsiteUrlParameter', {
      parameterName: '/petstore/petsiteurl',
      stringValue: 'https://d1cz8gv1106ws7.cloudfront.net',
      description: 'URL for the petsite application to be monitored by the canary',
      type: ssm.ParameterType.STRING,
    });

    // Create the canary
    this.canary = new synthetics.Canary(this, 'PetsiteCanary', {
      canaryName,
      runtime: new synthetics.Runtime(runtimeVersion, synthetics.RuntimeFamily.NODEJS),
      schedule: synthetics.Schedule.expression(scheduleExpression),
      test: synthetics.Test.custom({
        code: synthetics.Code.fromInline(this.getCanaryCode()),
        handler: 'index.handler',
      }),
      timeout,
      environmentVariables: {
        // Add any environment variables if needed
      },
      artifactsBucketLocation: {
        bucket: undefined,
        prefix: 'canary-artifacts/',
      } as any,
    });

    // Grant the canary permission to read the SSM parameter
    this.parameter.grantRead(this.canary.role!);

    // Add CloudWatch permissions for the canary
    this.canary.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchSyntheticsFullAccess')
    );

    // Store the canary function ARN for traffic generation
    this.canaryFunctionArn = `arn:aws:lambda:${Stack.of(this).region}:${Stack.of(this).account}:function:${canaryName}`;

    // Output the canary name, parameter ARN, and function ARN
    new cdk.CfnOutput(this, 'CanaryName', {
      value: this.canary.canaryName,
      description: 'Name of the created canary',
    });

    new cdk.CfnOutput(this, 'ParameterArn', {
      value: this.parameter.parameterArn,
      description: 'ARN of the SSM parameter containing the petsite URL',
    });

    new cdk.CfnOutput(this, 'CanaryFunctionArn', {
      value: this.canaryFunctionArn,
      description: 'ARN of the canary Lambda function for traffic generation',
    });
  }

  private getCanaryCode(): string {
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
}
