import { RemovalPolicy } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs'

export interface EcsServiceProps {
  cluster?: ecs.Cluster,

  cpu: number;
  memoryLimitMiB: number,
  logGroupName: string,

  healthCheck?: string,

  disableService?: boolean,
  instrumentation?: string,

  repositoryURI?: string,

  desiredTaskCount: number,

  region: string,

  securityGroup: ec2.SecurityGroup
}

export abstract class EcsService extends Construct {

  private static ExecutionRolePolicy = new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ['*'],
    actions: [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "logs:CreateLogGroup",
      "logs:DescribeLogStreams",
      "logs:CreateLogStream",
      "logs:DescribeLogGroups",
      "logs:PutLogEvents",
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
      "xray:GetSamplingStatisticSummaries",
      'ssm:GetParameters'
    ]
  });

  public readonly taskDefinition: ecs.TaskDefinition;
  public readonly service: ecs_patterns.ApplicationLoadBalancedServiceBase;
  public readonly container: ecs.ContainerDefinition;

  constructor(scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id);

    const logging = new ecs.AwsLogDriver({
      streamPrefix: "logs",
      logGroup: new logs.LogGroup(this, "ecs-log-group", {
        logGroupName: props.logGroupName,
        removalPolicy: RemovalPolicy.DESTROY
      })
    });

    /*
    const firelenslogging = new ecs.FireLensLogDriver({
      options: {
        "Name": "cloudwatch",
        "region": props.region,
        "log_key": "log",
        "log_group_name": props.logGroupName,
        "auto_create_group": "false",
        "log_stream_name": "$(ecs_task_id)"
      }
    });
   //*/

    const taskRole = new iam.Role(this, `taskRole`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, "taskDefinition", {
      cpu: props.cpu,
      taskRole: taskRole,
      memoryLimitMiB: props.memoryLimitMiB
    });

    this.taskDefinition.addToExecutionRolePolicy(EcsService.ExecutionRolePolicy);
    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AmazonECSTaskExecutionRolePolicy', 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'));
    this.taskDefinition.taskRole?.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSXrayWriteOnlyAccess', 'arn:aws:iam::aws:policy/AWSXrayWriteOnlyAccess'));

    // Build locally the image only if the repository URI is not specified
    // Can help speed up builds if we are not rebuilding anything
    const image = props.repositoryURI? this.containerImageFromRepository(props.repositoryURI) : this.createContainerImage()

    this.container = this.taskDefinition.addContainer('container', {
      image: image,
      memoryLimitMiB: 512,
      cpu: 256,
      logging,
      environment: { // clear text, not for sensitive data
        AWS_REGION: props.region,
      }
    });

    this.container.addPortMappings({
      containerPort: 80,
      protocol: ecs.Protocol.TCP
    });

    /*
    this.taskDefinition.addFirelensLogRouter('firelensrouter', {
      firelensConfig: {
        type: ecs.FirelensLogRouterType.FLUENTBIT
      },
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-for-fluent-bit:stable')
    })
   //*/

    // sidecar for instrumentation collecting
    switch(props.instrumentation) {

      // we don't add any sidecar if instrumentation is none
      case "none": {
        break;
      }

      // This collector would be used for both traces collected using
      // open telemetry or X-Ray
      case "otel": {
        this.addOtelCollectorContainer(this.taskDefinition, logging);
        break;
      }

      // Default X-Ray traces collector
      case "xray": {
        this.addXRayContainer(this.taskDefinition, logging);
        break;
      }

      // Default X-Ray traces collector
      // enabled by default
      default: {
        this.addXRayContainer(this.taskDefinition, logging);
        break;
      }
    }

    if (!props.disableService) {
      this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "ecs-service", {
        cluster: props.cluster,
        taskDefinition: this.taskDefinition,
        publicLoadBalancer: true,
        desiredCount: props.desiredTaskCount,
        listenerPort: 80,
        securityGroups: [props.securityGroup]

      })

      if (props.healthCheck) {
        this.service.targetGroup.configureHealthCheck({
          path: props.healthCheck
        });
      }
    }
  }

  abstract containerImageFromRepository(repositoryURI: string) : ecs.ContainerImage;

  abstract createContainerImage(): ecs.ContainerImage;

  private addXRayContainer(taskDefinition: ecs.FargateTaskDefinition, logging: ecs.AwsLogDriver) {
    taskDefinition.addContainer('xraydaemon', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/xray/aws-xray-daemon:3.3.4'),
      memoryLimitMiB: 256,
      cpu: 256,
      logging
    }).addPortMappings({
      containerPort: 2000,
      protocol: ecs.Protocol.UDP
    });
  }

  private addOtelCollectorContainer(taskDefinition: ecs.FargateTaskDefinition, logging: ecs.AwsLogDriver) {
    taskDefinition.addContainer('aws-otel-collector', {
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-otel-collector:v0.32.0'),
        memoryLimitMiB: 256,
        cpu: 256,
        command: ["--config", "/etc/ecs/ecs-xray.yaml"],
        logging
    });
  }
}
