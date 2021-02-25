import * as cdk from '@aws-cdk/core';

import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as lambda from '@aws-cdk/aws-lambda';
import * as pythonlambda from '@aws-cdk/aws-lambda-python';
import { Duration } from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as apigw from '@aws-cdk/aws-apigateway';
import { Tracing } from '@aws-cdk/aws-lambda';
import * as ssm from '@aws-cdk/aws-ssm';


export class PetAdoptionsStepFn extends cdk.Construct {
  public readonly stepFn: sfn.StateMachine;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id);

    var lambdaRole = new iam.Role(this, 'stepfnlambdaexecutionrole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'first', 'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'second', 'arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'third', 'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'fourth', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromManagedPolicyArn(this, 'fifth', 'arn:aws:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy')
      ]
    });

    var layerArn = "arn:aws:lambda:" + process.env.CDK_DEFAULT_REGION + ":580247275435:layer:LambdaInsightsExtension:2";
    //    var layerArn = "arn:aws:lambda:us-west-2:580247275435:layer:LambdaInsightsExtension:2";
    var layer = lambda.LayerVersion.fromLayerVersionArn(this, `LambdaInsights`, layerArn);

    var adotlayer = new lambda.LayerVersion(this, 'ADOTLayer', {
      code: new lambda.AssetCode('./resources/aws-distro-for-opentelemetry-python-38-preview.zip')
    });

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
      definition,
      tracingEnabled: true,
      timeout: Duration.minutes(5)
    });

  }

  private createStepFnLambda(lambdaFileName: string, lambdaRole: iam.Role, lambdalayers: lambda.ILayerVersion[]) {
    var pythonFn = new pythonlambda.PythonFunction(this, lambdaFileName, {
      entry: './resources/',
      index: lambdaFileName + '.py',
      handler: 'lambda_handler',
      runtime: lambda.Runtime.PYTHON_3_8,
      role: lambdaRole,
      layers: lambdalayers,
      tracing: Tracing.ACTIVE
    });
    pythonFn.addEnvironment("AWS_LAMBDA_EXEC_WRAPPER", "/opt/python/adot-instrument")
    return pythonFn;
  }
}