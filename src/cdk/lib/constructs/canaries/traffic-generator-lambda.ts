import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export interface TrafficGeneratorLambdaProps {
  /**
   * The name of the traffic generator lambda
   * @default 'traffic-generator-lambda'
   */
  functionName?: string;
  
  /**
   * The ARN of the canary function to invoke
   */
  canaryFunctionArn: string;
  
  /**
   * The number of concurrent users to simulate
   * @default 50
   */
  concurrentUsers?: number;
  
  /**
   * The schedule expression for traffic generation
   * @default 'rate(1 minute)'
   */
  scheduleExpression?: string;
  
  /**
   * Whether to enable the EventBridge schedule
   * @default true
   */
  enableSchedule?: boolean;
}

export class TrafficGeneratorLambda extends Construct {
  public readonly function: lambda.Function;
  public readonly schedule: events.Rule;

  constructor(scope: Construct, id: string, props: TrafficGeneratorLambdaProps) {
    super(scope, id);

    const {
      functionName = 'traffic-generator-lambda',
      canaryFunctionArn,
      concurrentUsers = 50,
      scheduleExpression = 'rate(1 minute)',
      enableSchedule = true
    } = props;

    // Create IAM role for the traffic generator lambda
    const trafficGeneratorRole = new iam.Role(this, 'TrafficGeneratorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        InvokeCanaryPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [canaryFunctionArn]
            })
          ]
        })
      }
    });

    // Create the traffic generator lambda function
    this.function = new lambda.Function(this, 'TrafficGeneratorFunction', {
      functionName,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(this.getTrafficGeneratorCode()),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: trafficGeneratorRole,
      environment: {
        CANARY_FUNCTION_ARN: canaryFunctionArn,
        CONCURRENT_USERS: concurrentUsers.toString(),
        LOG_LEVEL: 'INFO'
      }
    });

    // Create EventBridge rule for scheduling traffic generation
    if (enableSchedule) {
      this.schedule = new events.Rule(this, 'TrafficGeneratorSchedule', {
        ruleName: 'petstore-traffic-generator-schedule',
        description: 'Schedule for generating traffic using canary functions',
        schedule: events.Schedule.expression(scheduleExpression)
      });

      // Add the lambda as a target
      this.schedule.addTarget(new targets.LambdaFunction(this.function, {
        event: events.RuleTargetInput.fromObject({
          source: 'eventbridge',
          action: 'generate-traffic',
          timestamp: events.EventField.fromPath('$.time')
        })
      }));

      // Grant EventBridge permission to invoke the lambda
      this.function.addPermission('AllowEventBridgeInvoke', {
        principal: new iam.ServicePrincipal('events.amazonaws.com'),
        sourceArn: this.schedule.ruleArn
      });
    }

    // Output the function ARN and schedule ARN
    new cdk.CfnOutput(this, 'TrafficGeneratorFunctionArn', {
      value: this.function.functionArn,
      description: 'ARN of the traffic generator Lambda function',
    });

    if (enableSchedule) {
      new cdk.CfnOutput(this, 'TrafficGeneratorScheduleArn', {
        value: this.schedule.ruleArn,
        description: 'ARN of the EventBridge schedule for traffic generation',
      });
    }
  }

  private getTrafficGeneratorCode(): string {
    return `
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda();

exports.handler = async (event) => {
  console.log('Traffic generator started:', JSON.stringify(event));
  
  const canaryFunctionArn = process.env.CANARY_FUNCTION_ARN;
  const concurrentUsers = parseInt(process.env.CONCURRENT_USERS) || 50;
  
  console.log(\`Generating traffic for \${concurrentUsers} concurrent users\`);
  console.log(\`Invoking canary function: \${canaryFunctionArn}\`);
  
  const startTime = Date.now();
  const promises = [];
  
  // Create array of user IDs
  const userIds = Array.from({ length: concurrentUsers }, (_, i) => \`user\${String(i + 1).padStart(4, '0')}\`);
  
  // Invoke canary function for each user concurrently
  for (let i = 0; i < concurrentUsers; i++) {
    const userId = userIds[i];
    
    const invokeParams = {
      FunctionName: canaryFunctionArn,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({
        userId: userId,
        invocationId: \`\${Date.now()}-\${i}\`,
        source: 'traffic-generator',
        timestamp: new Date().toISOString()
      })
    };
    
    console.log(\`Invoking canary for user: \${userId}\`);
    promises.push(
      lambda.invoke(invokeParams).promise()
        .then(result => {
          console.log(\`Successfully invoked canary for user \${userId}\`);
          return { userId, success: true, result };
        })
        .catch(error => {
          console.error(\`Failed to invoke canary for user \${userId}:\`, error);
          return { userId, success: false, error: error.message };
        })
    );
  }
  
  // Wait for all invocations to complete
  console.log(\`Waiting for \${concurrentUsers} canary invocations to complete...\`);
  const results = await Promise.allSettled(promises);
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  // Analyze results
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
  
  console.log(\`Traffic generation completed in \${duration}ms\`);
  console.log(\`Successful invocations: \${successful}\`);
  console.log(\`Failed invocations: \${failed}\`);
  
  // Return summary
  return {
    statusCode: 200,
    body: {
      message: 'Traffic generation completed',
      totalUsers: concurrentUsers,
      successful,
      failed,
      duration: \`\${duration}ms\`,
      timestamp: new Date().toISOString()
    }
  };
};
`;
  }

  /**
   * Manually trigger traffic generation
   */
  public triggerTrafficGeneration(): void {
    // This method can be used to manually invoke the traffic generator
    // Implementation would depend on your specific needs
  }
}
