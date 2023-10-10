import { Duration, StackProps } from 'aws-cdk-lib';

import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as pythonlambda from '@aws-cdk/aws-lambda-python-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { Tracing } from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs'


export class PetAdoptionsStepFn extends Construct {
  public readonly stepFn: sfn.StateMachine;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id);

    var lambdaRole = new iam.Role(this, 'stepfnlambdaexecutionrole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'first', 'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'second', 'arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'third', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'fourth', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'fifth', 'arn:aws:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'sixth', 'arn:aws:iam::aws:policy/AmazonPrometheusRemoteWriteAccess')
      ]
    });

    var layerArn = "arn:aws:lambda:" + process.env.CDK_DEFAULT_REGION + ":580247275435:layer:LambdaInsightsExtension:38";
    var layer = lambda.LayerVersion.fromLayerVersionArn(this, `LambdaInsights`, layerArn);

    
    var adotLayerArn = "arn:aws:lambda:"+ process.env.CDK_DEFAULT_REGION + ":901920570463:layer:aws-otel-python-amd64-ver-1-19-0:2"
    var adotlayer = lambda.LayerVersion.fromLayerVersionArn(this,'otelPythonLambdaLayer',adotLayerArn);

    var layers: lambda.ILayerVersion[] = [layer, adotlayer]

    const readDynamoDB_Step = new tasks.LambdaInvoke(this, 'ReadDynamoDB', {
      lambdaFunction: this.createStepFnLambda('lambda_step_readDDB', lambdaRole, layers)
    });

    const priceGreaterThan55_Step = new tasks.LambdaInvoke(this, 'PriceGreaterThan55', {
      lambdaFunction: this.createStepFnLambda('lambda_step_priceGreaterThan55', lambdaRole, layers)
    });

    const priceLessThan55_Step = new tasks.LambdaInvoke(this, 'PriceLessThan55', {
      lambdaFunction: this.createStepFnLambda('lambda_step_priceLessThan55', lambdaRole, layers)
    });

    const priceEquals55_Step = new sfn.Succeed(this, 'PriceIs55');

    const definition = readDynamoDB_Step
      .next(new sfn.Choice(this, 'IsPriceGreaterThan55?')
        .when(sfn.Condition.numberGreaterThan('$.Payload.body.price', 55), priceGreaterThan55_Step)
        .when(sfn.Condition.numberLessThan('$.Payload.body.price', 55), priceLessThan55_Step)
        .otherwise(priceEquals55_Step));


    this.stepFn = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      tracingEnabled: true,
      timeout: Duration.minutes(5)
    });

  }

  private createStepFnLambda(lambdaFileName: string, lambdaRole: iam.Role, lambdalayers: lambda.ILayerVersion[]) {
    var pythonFn = new pythonlambda.PythonFunction(this, lambdaFileName, {
      entry: './resources/stepfn_lambdas/',
      index: lambdaFileName + '.py',
      handler: 'lambda_handler',
      memorySize: 128,
      runtime: lambda.Runtime.PYTHON_3_9,
      role: lambdaRole,
      layers: lambdalayers,
      tracing: Tracing.ACTIVE
    });
    pythonFn.addEnvironment("AWS_LAMBDA_EXEC_WRAPPER", "/opt/otel-instrument")
    return pythonFn;
  }
}
