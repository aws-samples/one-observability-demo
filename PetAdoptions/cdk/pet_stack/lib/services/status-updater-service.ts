import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as apigw from '@aws-cdk/aws-apigateway';

export interface StatusUpdaterServiceProps {
  tableName: string
}

export class StatusUpdaterService extends cdk.Construct {

  public api: apigw.RestApi

  constructor(scope: cdk.Construct, id: string, props: StatusUpdaterServiceProps) {
    super(scope, id);

    var lambdaRole = new iam.Role(this, 'lambdaexecutionrole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
          iam.ManagedPolicy.fromManagedPolicyArn(this, 'first', 'arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess'),
          iam.ManagedPolicy.fromManagedPolicyArn(this, 'second', 'arn:aws:iam::aws:policy/AWSLambda_FullAccess'),
          iam.ManagedPolicy.fromManagedPolicyArn(this, 'fifth', 'arn:aws:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy'),
          iam.ManagedPolicy.fromManagedPolicyArn(this, 'lambdaBasicExecRole', 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    var layerArn = "arn:aws:lambda:"+ process.env.CDK_DEFAULT_REGION +":580247275435:layer:LambdaInsightsExtension:2";
//    var layerArn = "arn:aws:lambda:us-west-2:580247275435:layer:LambdaInsightsExtension:2";
    var layer = lambda.LayerVersion.fromLayerVersionArn(this, `LayerFromArn`, layerArn);

    const lambdaFunction = new lambda.Function(this, 'lambdafn', {
        runtime: lambda.Runtime.NODEJS_12_X,    // execution environment
        code: lambda.Code.fromAsset('./resources/function.zip'), // Copy from Lambda folder or move here!!
        handler: 'index.handler',
        memorySize: 128,
        tracing: lambda.Tracing.ACTIVE,
        role: lambdaRole,
        layers: [layer],
        description: 'Update Pet availability status',
        environment: {
            "TABLE_NAME": props.tableName
        }
    });

    //defines an API Gateway REST API resource backed by our "petstatusupdater" function.
    this.api = new apigw.LambdaRestApi(this, 'PetAdoptionStatusUpdater', {
        handler: lambdaFunction,
        proxy: true,
        endpointConfiguration: {
            types: [apigw.EndpointType.REGIONAL]
        }, deployOptions: {
            tracingEnabled: true,
            loggingLevel:apigw.MethodLoggingLevel.INFO,
            stageName: 'prod'
        }, options: { defaultMethodOptions: { methodResponses: [] } }
        //defaultIntegration: new apigw.Integration({ integrationHttpMethod: 'PUT', type: apigw.IntegrationType.AWS })
    });
  }
}