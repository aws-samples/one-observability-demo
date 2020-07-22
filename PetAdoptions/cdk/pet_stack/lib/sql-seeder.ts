import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as lambda from '@aws-cdk/aws-lambda';
import * as rds from '@aws-cdk/aws-rds';
import * as cr from '@aws-cdk/custom-resources';
import * as ssm from '@aws-cdk/aws-ssm';

export interface SqlSeederProps {
  vpc: ec2.Vpc;
  database: rds.DatabaseInstance,
  port: number,
  username: string,
  password: string,
  ignoreSqlErrors?: boolean
}

export class SqlSeeder extends cdk.Construct {

  constructor(scope: cdk.Construct, id: string, props: SqlSeederProps) {
    super(scope, id);

    const dbIdentifier = props.database.instanceIdentifier;
    const rdsUsernameParameter = new ssm.StringParameter(this, 'RDSUsernameParameter', {
      parameterName: `/sql-seeder/${dbIdentifier}/username`,
      stringValue: props.username,
      simpleName: false
    });

    const rsdPasswordParameter = new ssm.StringParameter(this, 'RDSPasswordParameter', {
        parameterName: `/sql-seeder/${dbIdentifier}/password`,
        stringValue: props.password,
        simpleName: false
    });

    const sqlSeederLambda = new lambda.Function(this, 'sql-seeder-lambda', {      
        code: new lambda.AssetCode('./lambda/sqlserver-seeder.zip'),
        handler: 'seed::seed.Bootstrap::ExecuteFunction',
        timeout: cdk.Duration.seconds(300),
        runtime: lambda.Runtime.DOTNET_CORE_3_1,
        memorySize: 2048,
        vpc: props.vpc,
        vpcSubnets: {
            subnetType: ec2.SubnetType.PRIVATE
        },
        environment: {
            "DbEndpoint": props.database.dbInstanceEndpointAddress,
            "UsernameParameter": rdsUsernameParameter.parameterName,
            "PasswordParameter": rsdPasswordParameter.parameterName
        }
    });

    const sqlSeederProvider = new cr.Provider(this, 'sqlserver-seeder-provider', {
      onEventHandler: sqlSeederLambda
    });
    const sqlSeederResource = new cdk.CustomResource(this, 'SqlSeeder', { 
      serviceToken: sqlSeederProvider.serviceToken, 
      properties: {
        "IgnoreSqlErrors": !!props.ignoreSqlErrors
      }
     });
    sqlSeederResource.node.addDependency(props.database);

    // enable connection to RDS instance
    sqlSeederLambda.connections.allowTo(props.database, ec2.Port.tcp(props.port));
    // grant access to SSM parameters
    rdsUsernameParameter.grantRead(sqlSeederLambda);
    rsdPasswordParameter.grantRead(sqlSeederLambda);
  }
}
