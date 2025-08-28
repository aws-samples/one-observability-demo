import { Construct } from 'constructs';
import { Stack, StackProps, Tags, Duration } from 'aws-cdk-lib';
import { Stage } from 'aws-cdk-lib';
import { PetsiteCanary } from '../constructs/canaries';
import { TrafficGeneratorLambda } from '../constructs/canaries/traffic-generator-lambda';

export interface CanaryStageProps extends StackProps {
  /** Optional tags to apply to all resources */
  tags?: { [key: string]: string };
  /** Whether to enable traffic generation */
  enableTrafficGeneration?: boolean;
  /** Number of concurrent users for traffic generation */
  concurrentUsers?: number;
}

/**
 * Canary Stage for the One Observability Workshop.
 *
 * This stage deploys synthetic monitoring canaries that continuously
 * monitor the pet store application for availability and performance.
 */
export class CanaryStage extends Stage {
  constructor(scope: Construct, id: string, props: CanaryStageProps = {}) {
    super(scope, id, props);

    // Create a stack within the stage
    const canaryStack = new CanaryStack(this, 'CanaryStack', {
      env: props.env,
      tags: props.tags,
      enableTrafficGeneration: props.enableTrafficGeneration,
      concurrentUsers: props.concurrentUsers,
    });
  }
}

/**
 * Stack for canary resources
 */
export class CanaryStack extends Stack {
  public readonly petsiteCanary: PetsiteCanary;
  public readonly trafficGenerator?: TrafficGeneratorLambda;

  constructor(scope: Construct, id: string, props: CanaryStageProps) {
    super(scope, id, props);

    const {
      enableTrafficGeneration = false,
      concurrentUsers = 50
    } = props;

    // Create the petsite canary
    this.petsiteCanary = new PetsiteCanary(this, 'PetsiteCanary', {
      canaryName: 'petsite-canary',
      scheduleExpression: 'rate(1 minute)',
      runtimeVersion: 'syn-nodejs-puppeteer-10.0',
      timeout: Duration.seconds(60),
      enableTrafficGeneration,
      concurrentUsers,
    });

    // Create traffic generator if enabled
    if (enableTrafficGeneration) {
      this.trafficGenerator = new TrafficGeneratorLambda(this, 'TrafficGenerator', {
        functionName: 'petstore-traffic-generator',
        canaryFunctionArn: this.petsiteCanary.canaryFunctionArn,
        concurrentUsers,
        scheduleExpression: 'rate(1 minute)',
        enableSchedule: true,
      });
    }

    // Apply tags to all resources in this stage
    if (props.tags) {
      Tags.of(this).add('Stage', 'Canary');
      Object.entries(props.tags).forEach(([key, value]) => {
        Tags.of(this).add(key, value);
      });
    }
  }
}
