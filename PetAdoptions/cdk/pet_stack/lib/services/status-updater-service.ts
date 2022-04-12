import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejslambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs'

export interface StatusUpdaterServiceProps {
  tableName: string
}

export class StatusUpdaterService extends Construct {

  public api: apigw.RestApi

  constructor(scope: Construct, id: string, props: StatusUpdaterServiceProps) {
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
    
    var layerArn = "arn:aws:lambda:"+ process.env.CDK_DEFAULT_REGION +":580247275435:layer:LambdaInsightsExtension:14";
//    var layerArn = "arn:aws:lambda:us-west-2:580247275435:layer:LambdaInsightsExtension:2";
    var layer = lambda.LayerVersion.fromLayerVersionArn(this, `LayerFromArn`, layerArn);

    const lambdaFunction = new nodejslambda.NodejsFunction(this, 'lambdafn', {
        runtime: lambda.Runtime.NODEJS_12_X,    // execution environment
        entry: '../../petstatusupdater/index.js',
        depsLockFilePath: '../../petstatusupdater/package-lock.json',
        handler: 'handler',
        memorySize: 128,
        tracing: lambda.Tracing.ACTIVE,
        role: lambdaRole,
        layers: [layer],
        description: 'Update Pet availability status',
        environment: {
            "TABLE_NAME": props.tableName
        },
        bundling: {
          externalModules: [
            'aws-sdk'
          ],
          nodeModules: [
             'aws-xray-sdk'
          ]
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
        }, defaultMethodOptions: {methodResponses: [] }
        //defaultIntegration: new apigw.Integration({ integrationHttpMethod: 'PUT', type: apigw.IntegrationType.AWS })
    });
  }
}