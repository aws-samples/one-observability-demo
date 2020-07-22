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
          iam.ManagedPolicy.fromManagedPolicyArn(this, 'second', 'arn:aws:iam::aws:policy/AWSLambdaFullAccess')
      ]
    });

    const lambdaFunction = new lambda.Function(this, 'lambdafn', {
        runtime: lambda.Runtime.NODEJS_12_X,    // execution environment
        code: lambda.Code.fromAsset('../../petstatusupdater/function.zip'), 
        handler: 'index.handler',
        tracing: lambda.Tracing.ACTIVE,
        role: lambdaRole,
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