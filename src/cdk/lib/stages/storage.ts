/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Stack, StackProps, Stage, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AssetsProperties, WorkshopAssets } from '../constructs/assets';
import { DynamoDatabase as DynamoDatabase, DynamoDatabaseProperties } from '../constructs/dynamodb';
import { Utilities } from '../utils/utilities';
import { AuroraDatabase, AuroraDBProperties } from '../constructs/database';
import { WorkshopNetwork } from '../constructs/network';
import { CodeBuildStep } from 'aws-cdk-lib/pipelines';
import { ManagedPolicy, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { Function } from 'aws-cdk-lib/aws-lambda';
import { SecurityGroup, Port, IVpc, Peer } from 'aws-cdk-lib/aws-ec2';
import { PARAMETER_STORE_PREFIX, RDS_SEEDER_FUNCTION } from '../../bin/environment';
import { RdsSeederFunction } from '../serverless/functions/rds-seeder/rds-seeder';

export interface StorageProperties extends StackProps {
    assetsProperties?: AssetsProperties;
    dynamoDatabaseProperties?: DynamoDatabaseProperties;
    auroraDatabaseProperties?: AuroraDBProperties;
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
}

export class StorageStage extends Stage {
    public stack: StorageStack;
    constructor(scope: Construct, id: string, properties: StorageProperties) {
        super(scope, id, properties);
        this.stack = new StorageStack(this, 'StorageStack', properties);

        if (properties.tags) {
            Utilities.TagConstruct(this.stack, properties.tags);
        }
    }
    public getDDBSeedingStep(scope: Stack, artifactBucket: IBucket) {
        const seedingRole = new Role(scope, 'DDBSeedingRole', {
            assumedBy: new ServicePrincipal('codebuild.amazonaws.com'),
            description: 'CodeBuild role for DynamoDB seeding',
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess_v2')],
        });

        artifactBucket.grantRead(seedingRole);
        new Policy(scope, 'DDBSeedingPolicy', {
            roles: [seedingRole],
            statements: [
                new PolicyStatement({
                    actions: ['ssm:GetParameter'],
                    resources: ['*'],
                }),
            ],
        });

        // Seeding action role needs access to retrieve the table
        // name from Parameter store, and full access to dynamodb

        const seedStep = new CodeBuildStep('DDBSeeding', {
            commands: [
                'cd src/cdk',
                `PET_ADOPTION_TABLE_NAME=$(./scripts/get-parameter.sh ${SSM_PARAMETER_NAMES.PET_ADOPTION_TABLE_NAME})`,
                './scripts/seed-dynamodb.sh pets $PET_ADOPTION_TABLE_NAME',
                `PET_FOOD_TABLE_NAME=$(./scripts/get-parameter.sh ${SSM_PARAMETER_NAMES.PET_FOODS_TABLE_NAME})`,
                './scripts/seed-dynamodb.sh petfood $PET_FOOD_TABLE_NAME',
            ],
            buildEnvironment: {
                privileged: false,
            },
            role: seedingRole,
        });

        NagSuppressions.addResourceSuppressions(
            seedingRole,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'AWS Managed policies is acceptable for the DynamoDB Seeding action',
                },
            ],
            true,
        );

        return seedStep;
    }

    public getRDSSeedingStep(scope: Stack) {
        // Create a role for CodeBuild to invoke the Lambda function
        const lambdaInvokeRole = new Role(scope, 'RDSLambdaInvokeRole', {
            assumedBy: new ServicePrincipal('codebuild.amazonaws.com'),
        });

        // Add policy to invoke Lambda functions by name pattern
        new Policy(scope, 'RDSLambdaInvokePolicy', {
            roles: [lambdaInvokeRole],
            statements: [
                new PolicyStatement({
                    actions: ['lambda:InvokeFunction'],
                    resources: [`arn:aws:lambda:${scope.region}:${scope.account}:function:${RDS_SEEDER_FUNCTION.name}`],
                }),
            ],
        });

        const rdsSeedStep = new CodeBuildStep('RDSSeeding', {
            commands: [
                `LAMBDA_NAME="${RDS_SEEDER_FUNCTION.name}"`,
                'echo "Invoking RDS seeder Lambda..."',
                'aws lambda invoke --function-name "$LAMBDA_NAME" --invocation-type RequestResponse --cli-binary-format raw-in-base64-out response.json',
                'echo "Lambda response:"',
                'cat response.json',
                'echo ""',
                '# Check if the response indicates success',
                'if grep -q \'"statusCode": 200\' response.json; then',
                '  echo "✅ RDS seeding completed successfully"',
                'else',
                '  echo "❌ RDS seeding failed"',
                '  cat response.json',
                '  exit 1',
                'fi',
            ],
            buildEnvironment: {
                privileged: false,
            },
            role: lambdaInvokeRole,
        });

        NagSuppressions.addResourceSuppressions(
            lambdaInvokeRole,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'CodeBuild managed policies are acceptable for Lambda invocation',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Wildcard needed to invoke Lambda by name pattern across stages',
                },
            ],
            true,
        );

        return rdsSeedStep;
    }
}

export class StorageStack extends Stack {
    public readonly dynamoDatabase: DynamoDatabase;
    public readonly auroraDatabase: AuroraDatabase;
    public readonly workshopAssets: WorkshopAssets;
    public readonly rdsSeederLambda: Function;

    constructor(scope: Construct, id: string, properties: StorageProperties) {
        super(scope, id, properties);

        const vpc = WorkshopNetwork.importVpcFromExports(this, 'vpc');

        /** Add Assets resources */
        this.workshopAssets = new WorkshopAssets(this, 'WorkshopAssets', properties.assetsProperties);

        /** Add DynamoDB resource */
        this.dynamoDatabase = new DynamoDatabase(this, 'DynamoDb', properties.dynamoDatabaseProperties);

        const databaseProperties = properties.auroraDatabaseProperties || {};
        if (databaseProperties) {
            databaseProperties.vpc = vpc;
        }
        /** Add Database resource */
        this.auroraDatabase = new AuroraDatabase(this, 'AuroraDatabase', databaseProperties);

        /** Add RDS Seeder Lambda function */
        const rdsSeederFunction = new RdsSeederFunction(this, 'RdsSeederFunction', {
            name: RDS_SEEDER_FUNCTION.name,
            runtime: RDS_SEEDER_FUNCTION.runtime,
            entry: RDS_SEEDER_FUNCTION.entry,
            index: RDS_SEEDER_FUNCTION.index,
            memorySize: RDS_SEEDER_FUNCTION.memorySize,
            timeout: Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: {
                subnetGroupName: 'Private',
            },
            securityGroups: [this.createRdsSeederSecurityGroup(vpc)],
            databaseSecret: this.auroraDatabase.cluster.secret!,
            secretParameterName: `${PARAMETER_STORE_PREFIX}/${SSM_PARAMETER_NAMES.RDS_SECRET_ARN_NAME}`,
        });
        this.rdsSeederLambda = rdsSeederFunction.function;

        Utilities.SuppressLogRetentionNagWarnings(this);
    }

    private createRdsSeederSecurityGroup(vpc: IVpc): SecurityGroup {
        // Create security group for Lambda to access RDS
        const lambdaSecurityGroup = new SecurityGroup(this, 'RdsSeederLambdaSecurityGroup', {
            vpc: vpc,
            description: 'Security group for RDS seeder Lambda function',
        });

        // Allow Lambda to access RDS by adding ingress rule to RDS security group
        this.auroraDatabase.databaseSecurityGroup.addIngressRule(
            lambdaSecurityGroup,
            Port.POSTGRES,
            'RDS seeder Lambda access',
        );

        // Allow outbound HTTPS access for AWS API calls
        // TODO: Change to use VPCe
        lambdaSecurityGroup.addEgressRule(Peer.anyIpv4(), Port.tcp(443), 'HTTPS outbound for AWS API calls');

        return lambdaSecurityGroup;
    }
}
