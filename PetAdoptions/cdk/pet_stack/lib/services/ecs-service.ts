import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as ecs from '@aws-cdk/aws-ecs';
import * as logs from '@aws-cdk/aws-logs';
import * as ecs_patterns from '@aws-cdk/aws-ecs-patterns';

export interface EcsServiceProps {
  cluster?: ecs.Cluster,

  cpu: number;
  memoryLimitMiB: number,
  logGroupName: string,

  healthCheck?: string,

  disableService?: boolean,
  instrumentation?: string,
  
  repositoryURI: string,

  desiredTaskCount: number
}

export abstract class EcsService extends cdk.Construct {

  private static ExecutionRolePolicy = new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ['*'],
    actions: [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords"
    ]
  });

  public readonly taskDefinition: ecs.TaskDefinition;
  public readonly service: ecs_patterns.ApplicationLoadBalancedServiceBase;

  constructor(scope: cdk.Construct, id: string, props: EcsServiceProps) {
    super(scope, id);

    const logging = new ecs.AwsLogDriver({
      streamPrefix: "logs",
      logGroup: new logs.LogGroup(this, "ecs-log-group", {
        logGroupName: props.logGroupName,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      })
    });

    const firelenslogging = new ecs.FireLensLogDriver({
      options: {
        "Name": "cloudwatch",
        "region": process.env.AWS_REGION ?? "us-east-1",
        "log_key": "log",
        "log_group_name": props.logGroupName,
        "auto_create_group": "false",
        "log_stream_name": "$(ecs_task_id)"
      }
    });

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

    this.taskDefinition.addContainer('container', {
      image: this.createContainerImage(props.repositoryURI),
      memoryLimitMiB: 512,
      cpu: 256,
      logging: firelenslogging
    }).addPortMappings({
      containerPort: 80,
      protocol: ecs.Protocol.TCP
    });

    this.taskDefinition.addFirelensLogRouter('firelensrouter', {
      firelensConfig: {
        type: ecs.FirelensLogRouterType.FLUENTBIT
      },
      image: ecs.ContainerImage.fromRegistry('amazon/aws-for-fluent-bit:2.10.0')
    })
    
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
        listenerPort: 80
      })

      if (props.healthCheck) {
        this.service.targetGroup.configureHealthCheck({
          path: props.healthCheck
        });
      }
    }
  }
  
  abstract createContainerImage(repositoryURI: string) : ecs.ContainerImage;

  private addXRayContainer(taskDefinition: ecs.FargateTaskDefinition, logging: ecs.AwsLogDriver) {
    taskDefinition.addContainer('xraydaemon', {
      image: ecs.ContainerImage.fromRegistry('amazon/aws-xray-daemon'),
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
        image: ecs.ContainerImage.fromRegistry('amazon/aws-otel-collector'),
        memoryLimitMiB: 256,
        cpu: 256,
        logging
    });
  }
}
