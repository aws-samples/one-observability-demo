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
  disableXRay?: boolean,
  enableOpenTelemetry?: boolean
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

  private static AWSOpenTelemetryPolicy = new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    resources: ['*'],
    actions: [
      'logs:PutLogEvents',
      'logs:CreateLogGroup',
      'logs:CreateLogStream',
      'logs:DescribeLogStreams',
      'logs:DescribeLogGroups',
      'xray:PutTraceSegments',
      'xray:PutTelemetryRecords',
      'xray:GetSamplingRules',
      'xray:GetSamplingTargets',
      'xray:GetSamplingStatisticSummaries',
      'ssm:GetParameters'
    ]
  })

  public readonly taskDefinition: ecs.TaskDefinition;
  public readonly service: ecs_patterns.ApplicationLoadBalancedServiceBase;

  constructor(scope: cdk.Construct, id: string, props: EcsServiceProps  ) {
    super(scope, id);

    const logging = new ecs.AwsLogDriver({
      streamPrefix: "ecs-logs",
      logGroup: new logs.LogGroup(this, "ecs-log-group", {
        logGroupName: props.logGroupName,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      })
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
        image: this.createContainerImage(),
        memoryLimitMiB: 512,
        cpu: 256,
        logging: logging
    }).addPortMappings({
        containerPort: 80,
        protocol: ecs.Protocol.TCP
    });

    if (!props.disableXRay) {
      this.addXRayContainer(this.taskDefinition, logging);
    }else if (props.enableOpenTelemetry) {
      this.addOpenTelemetryContainer(this.taskDefinition, logging);
    }
    
    if (!props.disableService) {
      this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "ecs-service", {
        cluster: props.cluster,
        taskDefinition: this.taskDefinition,
        publicLoadBalancer: true,
        desiredCount: 2,
        listenerPort: 80
      })
      
      if (props.healthCheck) {
        this.service.targetGroup.configureHealthCheck({
          path: props.healthCheck
        });  
      }
    }
  }

  abstract createContainerImage() : ecs.ContainerImage;

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

  private addOpenTelemetryContainer(taskDefinition: ecs.FargateTaskDefinition, logging: ecs.AwsLogDriver) {
    taskDefinition.addToExecutionRolePolicy(EcsService.AWSOpenTelemetryPolicy);
    taskDefinition.addContainer('aws-otel-collector', {
      image: ecs.ContainerImage.fromRegistry('amazon/aws-otel-collector'),
      memoryLimitMiB: 512,
      cpu: 256,
      logging
    }).addPortMappings({
      containerPort: 2000,
      protocol: ecs.Protocol.UDP
    }, {
      containerPort: 55681,
      protocol: ecs.Protocol.TCP
    }, {
      containerPort: 8888,
      protocol: ecs.Protocol.TCP
    });
  }
}
