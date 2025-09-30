"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageStack = exports.StorageStage = void 0;
/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const aws_cdk_lib_1 = require("aws-cdk-lib");
const assets_1 = require("../constructs/assets");
const dynamodb_1 = require("../constructs/dynamodb");
const utilities_1 = require("../utils/utilities");
const database_1 = require("../constructs/database");
const network_1 = require("../constructs/network");
const pipelines_1 = require("aws-cdk-lib/pipelines");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const cdk_nag_1 = require("cdk-nag");
const constants_1 = require("../../bin/constants");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
const environment_1 = require("../../bin/environment");
const rds_seeder_1 = require("../serverless/functions/rds-seeder/rds-seeder");
class StorageStage extends aws_cdk_lib_1.Stage {
    constructor(scope, id, properties) {
        super(scope, id, properties);
        this.stack = new StorageStack(this, 'StorageStack', properties);
        if (properties.tags) {
            utilities_1.Utilities.TagConstruct(this.stack, properties.tags);
        }
    }
    getDDBSeedingStep(scope, artifactBucket) {
        const seedingRole = new aws_iam_1.Role(scope, 'DDBSeedingRole', {
            assumedBy: new aws_iam_1.ServicePrincipal('codebuild.amazonaws.com'),
            description: 'CodeBuild role for DynamoDB seeding',
            managedPolicies: [aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess_v2')],
        });
        artifactBucket.grantRead(seedingRole);
        new aws_iam_1.Policy(scope, 'DDBSeedingPolicy', {
            roles: [seedingRole],
            statements: [
                new aws_iam_1.PolicyStatement({
                    actions: ['ssm:GetParameter'],
                    resources: ['*'],
                }),
            ],
        });
        // Seeding action role needs access to retrieve the table
        // name from Parameter store, and full access to dynamodb
        const seedStep = new pipelines_1.CodeBuildStep('DDBSeeding', {
            commands: [
                'cd src/cdk',
                `PET_ADOPTION_TABLE_NAME=$(./scripts/get-parameter.sh ${constants_1.SSM_PARAMETER_NAMES.PET_ADOPTION_TABLE_NAME})`,
                './scripts/seed-dynamodb.sh pets $PET_ADOPTION_TABLE_NAME',
                `PET_FOOD_TABLE_NAME=$(./scripts/get-parameter.sh ${constants_1.SSM_PARAMETER_NAMES.PET_FOODS_TABLE_NAME})`,
                './scripts/seed-dynamodb.sh petfood $PET_FOOD_TABLE_NAME',
            ],
            buildEnvironment: {
                privileged: false,
            },
            role: seedingRole,
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(seedingRole, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWS Managed policies is acceptable for the DynamoDB Seeding action',
            },
        ], true);
        return seedStep;
    }
    getRDSSeedingStep(scope) {
        // Create a role for CodeBuild to invoke the Lambda function
        const lambdaInvokeRole = new aws_iam_1.Role(scope, 'RDSLambdaInvokeRole', {
            assumedBy: new aws_iam_1.ServicePrincipal('codebuild.amazonaws.com'),
        });
        // Add policy to invoke Lambda functions by name pattern
        new aws_iam_1.Policy(scope, 'RDSLambdaInvokePolicy', {
            roles: [lambdaInvokeRole],
            statements: [
                new aws_iam_1.PolicyStatement({
                    actions: ['lambda:InvokeFunction'],
                    resources: [`arn:aws:lambda:${scope.region}:${scope.account}:function:${environment_1.RDS_SEEDER_FUNCTION.name}`],
                }),
            ],
        });
        const rdsSeedStep = new pipelines_1.CodeBuildStep('RDSSeeding', {
            commands: [
                `LAMBDA_NAME="${environment_1.RDS_SEEDER_FUNCTION.name}"`,
                'echo "Invoking RDS seeder Lambda..."',
                'aws lambda invoke --function-name "$LAMBDA_NAME" --invocation-type RequestResponse --cli-binary-format raw-in-base64-out response.json',
                'echo "Lambda response:"',
                'cat response.json',
                'echo ""',
                'if grep -q \'"statusCode": 200\' response.json; then echo "✅ RDS seeding completed successfully"; else echo "❌ RDS seeding failed"; cat response.json; exit 1; fi',
            ],
            buildEnvironment: {
                privileged: false,
            },
            role: lambdaInvokeRole,
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(lambdaInvokeRole, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'CodeBuild managed policies are acceptable for Lambda invocation',
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard needed to invoke Lambda by name pattern across stages',
            },
        ], true);
        return rdsSeedStep;
    }
}
exports.StorageStage = StorageStage;
class StorageStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, properties) {
        super(scope, id, properties);
        const vpc = network_1.WorkshopNetwork.importVpcFromExports(this, 'vpc');
        /** Add Assets resources */
        this.workshopAssets = new assets_1.WorkshopAssets(this, 'WorkshopAssets', properties.assetsProperties);
        /** Add DynamoDB resource */
        this.dynamoDatabase = new dynamodb_1.DynamoDatabase(this, 'DynamoDb', properties.dynamoDatabaseProperties);
        const databaseProperties = properties.auroraDatabaseProperties || {};
        if (databaseProperties) {
            databaseProperties.vpc = vpc;
        }
        /** Add Database resource */
        this.auroraDatabase = new database_1.AuroraDatabase(this, 'AuroraDatabase', databaseProperties);
        /** Add RDS Seeder Lambda function */
        const rdsSeederFunction = new rds_seeder_1.RdsSeederFunction(this, 'RdsSeederFunction', {
            name: environment_1.RDS_SEEDER_FUNCTION.name,
            runtime: environment_1.RDS_SEEDER_FUNCTION.runtime,
            entry: environment_1.RDS_SEEDER_FUNCTION.entry,
            index: environment_1.RDS_SEEDER_FUNCTION.index,
            memorySize: environment_1.RDS_SEEDER_FUNCTION.memorySize,
            timeout: aws_cdk_lib_1.Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: {
                subnetGroupName: 'Private',
            },
            securityGroups: [this.createRdsSeederSecurityGroup(vpc)],
            databaseSecret: this.auroraDatabase.cluster.secret,
            secretParameterName: `${environment_1.PARAMETER_STORE_PREFIX}/${constants_1.SSM_PARAMETER_NAMES.RDS_SECRET_ARN_NAME}`,
        });
        this.rdsSeederLambda = rdsSeederFunction.function;
        utilities_1.Utilities.SuppressLogRetentionNagWarnings(this);
    }
    createRdsSeederSecurityGroup(vpc) {
        // Create security group for Lambda to access RDS
        const lambdaSecurityGroup = new aws_ec2_1.SecurityGroup(this, 'RdsSeederLambdaSecurityGroup', {
            vpc: vpc,
            description: 'Security group for RDS seeder Lambda function',
        });
        // Allow Lambda to access RDS by adding ingress rule to RDS security group
        this.auroraDatabase.databaseSecurityGroup.addIngressRule(lambdaSecurityGroup, aws_ec2_1.Port.POSTGRES, 'RDS seeder Lambda access');
        // Allow outbound HTTPS access for AWS API calls
        // TODO: Change to use VPCe
        lambdaSecurityGroup.addEgressRule(aws_ec2_1.Peer.anyIpv4(), aws_ec2_1.Port.tcp(443), 'HTTPS outbound for AWS API calls');
        return lambdaSecurityGroup;
    }
}
exports.StorageStack = StorageStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInN0b3JhZ2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUE7OztFQUdFO0FBQ0YsNkNBQWlFO0FBRWpFLGlEQUF3RTtBQUN4RSxxREFBb0c7QUFDcEcsa0RBQStDO0FBQy9DLHFEQUE0RTtBQUM1RSxtREFBd0Q7QUFDeEQscURBQXNEO0FBQ3RELGlEQUFxRztBQUNyRyxxQ0FBMEM7QUFFMUMsbURBQTBEO0FBRTFELGlEQUFzRTtBQUN0RSx1REFBb0Y7QUFDcEYsOEVBQWtGO0FBVWxGLE1BQWEsWUFBYSxTQUFRLG1CQUFLO0lBRW5DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsVUFBNkI7UUFDbkUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFDN0IsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLFlBQVksQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRWhFLElBQUksVUFBVSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ2xCLHFCQUFTLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3hELENBQUM7SUFDTCxDQUFDO0lBQ00saUJBQWlCLENBQUMsS0FBWSxFQUFFLGNBQXVCO1FBQzFELE1BQU0sV0FBVyxHQUFHLElBQUksY0FBSSxDQUFDLEtBQUssRUFBRSxnQkFBZ0IsRUFBRTtZQUNsRCxTQUFTLEVBQUUsSUFBSSwwQkFBZ0IsQ0FBQyx5QkFBeUIsQ0FBQztZQUMxRCxXQUFXLEVBQUUscUNBQXFDO1lBQ2xELGVBQWUsRUFBRSxDQUFDLHVCQUFhLENBQUMsd0JBQXdCLENBQUMsNkJBQTZCLENBQUMsQ0FBQztTQUMzRixDQUFDLENBQUM7UUFFSCxjQUFjLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3RDLElBQUksZ0JBQU0sQ0FBQyxL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QUFFO1NBQzlGLENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxlQUFlLEdBQUcsaUJBQWlCLENBQUMsUUFBUSxDQUFDO1FBRWxELHFCQUFTLENBQUMsK0JBQStCLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDcEQsQ0FBQztJQUVPLDRCQUE0QixDQUFDLEdBQVM7UUFDMUMsaURBQWlEO1FBQ2pELE1BQU0sbUJBQW1CLEdBQUcsSUFBSSx1QkFBYSxDQUFDLElBQUksRUFBRSw4QkFBOEIsRUFBRTtZQUNoRixHQUFHLEVBQUUsR0FBRztZQUNSLFdBQVcsRUFBRSwrQ0FBK0M7U0FDL0QsQ0FBQyxDQUFDO1FBRUgsMEVBQTBFO1FBQzFFLElBQUksQ0FBQyxjQUFjLENBQUMscUJBQXFCLENBQUMsY0FBYyxDQUNwRCxtQkFBbUIsRUFDbkIsY0FBSSxDQUFDLFFBQVEsRUFDYiwwQkFBMEIsQ0FDN0IsQ0FBQztRQUVGLGdEQUFnRDtRQUNoRCwyQkFBMkI7UUFDM0IsbUJBQW1CLENBQUMsYUFBYSxDQUFDLGNBQUksQ0FBQyxPQUFPLEVBQUUsRUFBRSxjQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLGtDQUFrQyxDQUFDLENBQUM7UUFFckcsT0FBTyxtQkFBbUIsQ0FBQztJQUMvQixDQUFDO0NBQ0o7QUFqRUQsb0NBaUVDIiwic291cmNlc0NvbnRlbnQiOlsiLypcbkNvcHlyaWdodCBBbWF6b24uY29tLCBJbmMuIG9yIGl0cyBhZmZpbGlhdGVzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcbiovXG5pbXBvcnQgeyBTdGFjaywgU3RhY2tQcm9wcywgU3RhZ2UsIER1cmF0aW9uIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBBc3NldHNQcm9wZXJ0aWVzLCBXb3Jrc2hvcEFzc2V0cyB9IGZyb20gJy4uL2NvbnN0cnVjdHMvYXNzZXRzJztcbmltcG9ydCB7IER5bmFtb0RhdGFiYXNlIGFzIER5bmFtb0RhdGFiYXNlLCBEeW5hbW9EYXRhYmFzZVByb3BlcnRpZXMgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL2R5bmFtb2RiJztcbmltcG9ydCB7IFV0aWxpdGllcyB9IGZyb20gJy4uL3V0aWxzL3V0aWxpdGllcyc7XG5pbXBvcnQgeyBBdXJvcmFEYXRhYmFzZSwgQXVyb3JhREJQcm9wZXJ0aWVzIH0gZnJvbSAnLi4vY29uc3RydWN0cy9kYXRhYmFzZSc7XG5pbXBvcnQgeyBXb3Jrc2hvcE5ldHdvcmsgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL25ldHdvcmsnO1xuaW1wb3J0IHsgQ29kZUJ1aWxkU3RlcCB9IGZyb20gJ2F3cy1jZGstbGliL3BpcGVsaW5lcyc7XG5pbXBvcnQgeyBNYW5hZ2VkUG9saWN5LCBQb2xpY3ksIFBvbGljeVN0YXRlbWVudCwgUm9sZSwgU2VydmljZVByaW5jaXBhbCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5pbXBvcnQgeyBJQnVja2V0IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCB7IFNTTV9QQVJBTUVURVJfTkFNRVMgfSBmcm9tICcuLi8uLi9iaW4vY29uc3RhbnRzJztcbmltcG9ydCB7IEZ1bmN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBTZWN1cml0eUdyb3VwLCBQb3J0LCBJVnBjLCBQZWVyIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBQQVJBTUVURVJfU1RPUkVfUFJFRklYLCBSRFNfU0VFREVSX0ZVTkNUSU9OIH0gZnJvbSAnLi4vLi4vYmluL2Vudmlyb25tZW50JztcbmltcG9ydCB7IFJkc1NlZWRlckZ1bmN0aW9uIH0gZnJvbSAnLi4vc2VydmVybGVzcy9mdW5jdGlvbnMvcmRzLXNlZWRlci9yZHMtc2VlZGVyJztcblxuZXhwb3J0IGludGVyZmFjZSBTdG9yYWdlUHJvcGVydGllcyBleHRlbmRzIFN0YWNrUHJvcHMge1xuICAgIGFzc2V0c1Byb3BlcnRpZXM/OiBBc3NldHNQcm9wZXJ0aWVzO1xuICAgIGR5bmFtb0RhdGFiYXNlUHJvcGVydGllcz86IER5bmFtb0RhdGFiYXNlUHJvcGVydGllcztcbiAgICBhdXJvcmFEYXRhYmFzZVByb3BlcnRpZXM/OiBBdXJvcmFEQlByb3BlcnRpZXM7XG4gICAgLyoqIFRhZ3MgdG8gYXBwbHkgdG8gYWxsIHJlc291cmNlcyBpbiB0aGUgc3RhZ2UgKi9cbiAgICB0YWdzPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbn1cblxuZXhwb3J0IGNsYXNzIFN0b3JhZ2VTdGFnZSBleHRlbmRzIFN0YWdlIHtcbiAgICBwdWJsaWMgc3RhY2s6IFN0b3JhZ2VTdGFjaztcbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wZXJ0aWVzOiBTdG9yYWdlUHJvcGVydGllcykge1xuICAgICAgICBzdXBlcihzY29wZSwgaWQsIHByb3BlcnRpZXMpO1xuICAgICAgICB0aGlzLnN0YWNrID0gbmV3IFN0b3JhZ2VTdGFjayh0aGlzLCAnU3RvcmFnZVN0YWNrJywgcHJvcGVydGllcyk7XG5cbiAgICAgICAgaWYgKHByb3BlcnRpZXMudGFncykge1xuICAgICAgICAgICAgVXRpbGl0aWVzLlRhZ0NvbnN0cnVjdCh0aGlzLnN0YWNrLCBwcm9wZXJ0aWVzLnRhZ3MpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHB1YmxpYyBnZXREREJTZWVkaW5nU3RlcChzY29wZTogU3RhY2ssIGFydGlmYWN0QnVja2V0OiBJQnVja2V0KSB7XG4gICAgICAgIGNvbnN0IHNlZWRpbmdSb2xlID0gbmV3IFJvbGUoc2NvcGUsICdEREJTZWVkaW5nUm9sZScsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoJ2NvZGVidWlsZC5hbWF6b25hd3MuY29tJyksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvZGVCdWlsZCByb2xlIGZvciBEeW5hbW9EQiBzZWVkaW5nJyxcbiAgICAgICAgICAgIG1hbmFnZWRQb2xpY2llczogW01hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25EeW5hbW9EQkZ1bGxBY2Nlc3NfdjInKV0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGFydGlmYWN0QnVja2V0LmdyYW50UmVhZChzZWVkaW5nUm9sZSk7XG4gICAgICAgIG5ldyBQb2xpY3koc2NvcGUsICdEREJTZWVkaW5nUG9saWN5Jywge1xuICAgICAgICAgICAgcm9sZXM6IFtzZWVkaW5nUm9sZV0sXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnc3NtOkdldFBhcmFtZXRlciddLFxuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gU2VlZGluZyBhY3Rpb24gcm9sZSBuZWVkcyBhY2Nlc3MgdG8gcmV0cmlldmUgdGhlIHRhYmxlXG4gICAgICAgIC8vIG5hbWUgZnJvbSBQYXJhbWV0ZXIgc3RvcmUsIGFuZCBmdWxsIGFjY2VzcyB0byBkeW5hbW9kYlxuXG4gICAgICAgIGNvbnN0IHNlZWRTdGVwID0gbmV3IENvZGVCdWlsZFN0ZXAoJ0REQlNlZWRpbmcnLCB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAgICdjZCBzcmMvY2RrJyxcbiAgICAgICAgICAgICAgICBgUEVUX0FET1BUSU9OX1RBQkxFX05BTUU9JCguL3NjcmlwdHMvZ2V0LXBhcmFtZXRlci5zaCAke1NTTV9QQVJBTUVURVJfTkFNRVMuUEVUX0FET1BUSU9OX1RBQkxFX05BTUV9KWAsXG4gICAgICAgICAgICAgICAgJy4vc2NyaXB0cy9zZWVkLWR5bmFtb2RiLnNoIHBldHMgJFBFVF9BRE9QVElPTl9UQUJMRV9OQU1FJyxcbiAgICAgICAgICAgICAgICBgUEVUX0ZPT0RfVEFCTEVfTkFNRT0kKC4vc2NyaXB0cy9nZXQtcGFyYW1ldGVyLnNoICR7U1NNX1BBUkFNRVRFUl9OQU1FUy5QRVRfRk9PRFNfVEFCTEVfTkFNRX0pYCxcbiAgICAgICAgICAgICAgICAnLi9zY3JpcHRzL3NlZWQtZHluYW1vZGIuc2ggcGV0Zm9vZCAkUEVUX0ZPT0RfVEFCTEVfTkFNRScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYnVpbGRFbnZpcm9ubWVudDoge1xuICAgICAgICAgICAgICAgIHByaXZpbGVnZWQ6IGZhbHNlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJvbGU6IHNlZWRpbmdSb2xlLFxuICAgICAgICB9KTtcblxuICAgICAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICAgICAgICBzZWVkaW5nUm9sZSxcbiAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICAgICAgICAgICAgICByZWFzb246ICdBV1MgTWFuYWdlZCBwb2xpY2llcyBpcyBhY2NlcHRhYmxlIGZvciB0aGUgRHluYW1vREIgU2VlZGluZyBhY3Rpb24nLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgKTtcblxuICAgICAgICByZXR1cm4gc2VlZFN0ZXA7XG4gICAgfVxuXG4gICAgcHVibGljIGdldFJEU1NlZWRpbmdTdGVwKHNjb3BlOiBTdGFjaykge1xuICAgICAgICAvLyBDcmVhdGUgYSByb2xlIGZvciBDb2RlQnVpbGQgdG8gaW52b2tlIHRoZSBMYW1iZGEgZnVuY3Rpb25cbiAgICAgICAgY29uc3QgbGFtYmRhSW52b2tlUm9sZSA9IG5ldyBSb2xlKHNjb3BlLCAnUkRTTGFtYmRhSW52b2tlUm9sZScsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoJ2NvZGVidWlsZC5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFkZCBwb2xpY3kgdG8gaW52b2tlIExhbWJkYSBmdW5jdGlvbnMgYnkgbmFtZSBwYXR0ZXJuXG4gICAgICAgIG5ldyBQb2xpY3koc2NvcGUsICdSRFNMYW1iZGFJbnZva2VQb2xpY3knLCB7XG4gICAgICAgICAgICByb2xlczogW2xhbWJkYUludm9rZVJvbGVdLFxuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpJbnZva2VGdW5jdGlvbiddLFxuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsYW1iZGE6JHtzY29wZS5yZWdpb259OiR7c2NvcGUuYWNjb3VudH06ZnVuY3Rpb246JHtSRFNfU0VFREVSX0ZVTkNUSU9OLm5hbWV9YF0sXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCByZHNTZWVkU3RlcCA9IG5ldyBDb2RlQnVpbGRTdGVwKCdSRFNTZWVkaW5nJywge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgICBgTEFNQkRBX05BTUU9XCIke1JEU19TRUVERVJfRlVOQ1RJT04ubmFtZX1cImAsXG4gICAgICAgICAgICAgICAgJ2VjaG8gXCJJbnZva2luZyBSRFMgc2VlZGVyIExhbWJkYS4uLlwiJyxcbiAgICAgICAgICAgICAgICAnYXdzIGxhbWJkYSBpbnZva2UgLS1mdW5jdGlvbi1uYW1lIFwiJExBTUJEQV9OQU1FXCIgLS1pbnZvY2F0aW9uLXR5cGUgUmVxdWVzdFJlc3BvbnNlIC0tY2xpLWJpbmFyeS1mb3JtYXQgcmF3LWluLWJhc2U2NC1vdXQgcmVzcG9uc2UuanNvbicsXG4gICAgICAgICAgICAgICAgJ2VjaG8gXCJMYW1iZGEgcmVzcG9uc2U6XCInLFxuICAgICAgICAgICAgICAgICdjYXQgcmVzcG9uc2UuanNvbicsXG4gICAgICAgICAgICAgICAgJ2VjaG8gXCJcIicsXG4gICAgICAgICAgICAgICAgJ2lmIGdyZXAgLXEgXFwnXCJzdGF0dXNDb2RlXCI6IDIwMFxcJyByZXNwb25zZS5qc29uOyB0aGVuIGVjaG8gXCLinIUgUkRTIHNlZWRpbmcgY29tcGxldGVkIHN1Y2Nlc3NmdWxseVwiOyBlbHNlIGVjaG8gXCLinYwgUkRTIHNlZWRpbmcgZmFpbGVkXCI7IGNhdCByZXNwb25zZS5qc29uOyBleGl0IDE7IGZpJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBidWlsZEVudmlyb25tZW50OiB7XG4gICAgICAgICAgICAgICAgcHJpdmlsZWdlZDogZmFsc2UsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcm9sZTogbGFtYmRhSW52b2tlUm9sZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgICAgICAgbGFtYmRhSW52b2tlUm9sZSxcbiAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICAgICAgICAgICAgICByZWFzb246ICdDb2RlQnVpbGQgbWFuYWdlZCBwb2xpY2llcyBhcmUgYWNjZXB0YWJsZSBmb3IgTGFtYmRhIGludm9jYXRpb24nLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICAgICAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgbmVlZGVkIHRvIGludm9rZSBMYW1iZGEgYnkgbmFtZSBwYXR0ZXJuIGFjcm9zcyBzdGFnZXMnLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgdHJ1ZSxcbiAgICAgICAgKTtcblxuICAgICAgICByZXR1cm4gcmRzU2VlZFN0ZXA7XG4gICAgfVxufVxuXG5leHBvcnQgY2xhc3MgU3RvcmFnZVN0YWNrIGV4dGVuZHMgU3RhY2sge1xuICAgIHB1YmxpYyByZWFkb25seSBkeW5hbW9EYXRhYmFzZTogRHluYW1vRGF0YWJhc2U7XG4gICAgcHVibGljIHJlYWRvbmx5IGF1cm9yYURhdGFiYXNlOiBBdXJvcmFEYXRhYmFzZTtcbiAgICBwdWJsaWMgcmVhZG9ubHkgd29ya3Nob3BBc3NldHM6IFdvcmtzaG9wQXNzZXRzO1xuICAgIHB1YmxpYyByZWFkb25seSByZHNTZWVkZXJMYW1iZGE6IEZ1bmN0aW9uO1xuXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcGVydGllczogU3RvcmFnZVByb3BlcnRpZXMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wZXJ0aWVzKTtcblxuICAgICAgICBjb25zdCB2cGMgPSBXb3Jrc2hvcE5ldHdvcmsuaW1wb3J0VnBjRnJvbUV4cG9ydHModGhpcywgJ3ZwYycpO1xuXG4gICAgICAgIC8qKiBBZGQgQXNzZXRzIHJlc291cmNlcyAqL1xuICAgICAgICB0aGlzLndvcmtzaG9wQXNzZXRzID0gbmV3IFdvcmtzaG9wQXNzZXRzKHRoaXMsICdXb3Jrc2hvcEFzc2V0cycsIHByb3BlcnRpZXMuYXNzZXRzUHJvcGVydGllcyk7XG5cbiAgICAgICAgLyoqIEFkZCBEeW5hbW9EQiByZXNvdXJjZSAqL1xuICAgICAgICB0aGlzLmR5bmFtb0RhdGFiYXNlID0gbmV3IER5bmFtb0RhdGFiYXNlKHRoaXMsICdEeW5hbW9EYicsIHByb3BlcnRpZXMuZHluYW1vRGF0YWJhc2VQcm9wZXJ0aWVzKTtcblxuICAgICAgICBjb25zdCBkYXRhYmFzZVByb3BlcnRpZXMgPSBwcm9wZXJ0aWVzLmF1cm9yYURhdGFiYXNlUHJvcGVydGllcyB8fCB7fTtcbiAgICAgICAgaWYgKGRhdGFiYXNlUHJvcGVydGllcykge1xuICAgICAgICAgICAgZGF0YWJhc2VQcm9wZXJ0aWVzLnZwYyA9IHZwYztcbiAgICAgICAgfVxuICAgICAgICAvKiogQWRkIERhdGFiYXNlIHJlc291cmNlICovXG4gICAgICAgIHRoaXMuYXVyb3JhRGF0YWJhc2UgPSBuZXcgQXVyb3JhRGF0YWJhc2UodGhpcywgJ0F1cm9yYURhdGFiYXNlJywgZGF0YWJhc2VQcm9wZXJ0aWVzKTtcblxuICAgICAgICAvKiogQWRkIFJEUyBTZWVkZXIgTGFtYmRhIGZ1bmN0aW9uICovXG4gICAgICAgIGNvbnN0IHJkc1NlZWRlckZ1bmN0aW9uID0gbmV3IFJkc1NlZWRlckZ1bmN0aW9uKHRoaXMsICdSZHNTZWVkZXJGdW5jdGlvbicsIHtcbiAgICAgICAgICAgIG5hbWU6IFJEU19TRUVERVJfRlVOQ1RJT04ubmFtZSxcbiAgICAgICAgICAgIHJ1bnRpbWU6IFJEU19TRUVERVJfRlVOQ1RJT04ucnVudGltZSxcbiAgICAgICAgICAgIGVudHJ5OiBSRFNfU0VFREVSX0ZVTkNUSU9OLmVudHJ5LFxuICAgICAgICAgICAgaW5kZXg6IFJEU19TRUVERVJfRlVOQ1RJT04uaW5kZXgsXG4gICAgICAgICAgICBtZW1vcnlTaXplOiBSRFNfU0VFREVSX0ZVTkNUSU9OLm1lbW9yeVNpemUsXG4gICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgdnBjOiB2cGMsXG4gICAgICAgICAgICB2cGNTdWJuZXRzOiB7XG4gICAgICAgICAgICAgICAgc3VibmV0R3JvdXBOYW1lOiAnUHJpdmF0ZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2VjdXJpdHlHcm91cHM6IFt0aGlzLmNyZWF0ZVJkc1NlZWRlclNlY3VyaXR5R3JvdXAodnBjKV0sXG4gICAgICAgICAgICBkYXRhYmFzZVNlY3JldDogdGhpcy5hdXJvcmFEYXRhYmFzZS5jbHVzdGVyLnNlY3JldCEsXG4gICAgICAgICAgICBzZWNyZXRQYXJhbWV0ZXJOYW1lOiBgJHtQQVJBTUVURVJfU1RPUkVfUFJFRklYfS8ke1NTTV9QQVJBTUVURVJfTkFNRVMuUkRTX1NFQ1JFVF9BUk5fTkFNRX1gLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5yZHNTZWVkZXJMYW1iZGEgPSByZHNTZWVkZXJGdW5jdGlvbi5mdW5jdGlvbjtcblxuICAgICAgICBVdGlsaXRpZXMuU3VwcHJlc3NMb2dSZXRlbnRpb25OYWdXYXJuaW5ncyh0aGlzKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGNyZWF0ZVJkc1NlZWRlclNlY3VyaXR5R3JvdXAodnBjOiBJVnBjKTogU2VjdXJpdHlHcm91cCB7XG4gICAgICAgIC8vIENyZWF0ZSBzZWN1cml0eSBncm91cCBmb3IgTGFtYmRhIHRvIGFjY2VzcyBSRFNcbiAgICAgICAgY29uc3QgbGFtYmRhU2VjdXJpdHlHcm91cCA9IG5ldyBTZWN1cml0eUdyb3VwKHRoaXMsICdSZHNTZWVkZXJMYW1iZGFTZWN1cml0eUdyb3VwJywge1xuICAgICAgICAgICAgdnBjOiB2cGMsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBSRFMgc2VlZGVyIExhbWJkYSBmdW5jdGlvbicsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEFsbG93IExhbWJkYSB0byBhY2Nlc3MgUkRTIGJ5IGFkZGluZyBpbmdyZXNzIHJ1bGUgdG8gUkRTIHNlY3VyaXR5IGdyb3VwXG4gICAgICAgIHRoaXMuYXVyb3JhRGF0YWJhc2UuZGF0YWJhc2VTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgICAgICAgbGFtYmRhU2VjdXJpdHlHcm91cCxcbiAgICAgICAgICAgIFBvcnQuUE9TVEdSRVMsXG4gICAgICAgICAgICAnUkRTIHNlZWRlciBMYW1iZGEgYWNjZXNzJyxcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBBbGxvdyBvdXRib3VuZCBIVFRQUyBhY2Nlc3MgZm9yIEFXUyBBUEkgY2FsbHNcbiAgICAgICAgLy8gVE9ETzogQ2hhbmdlIHRvIHVzZSBWUENlXG4gICAgICAgIGxhbWJkYVNlY3VyaXR5R3JvdXAuYWRkRWdyZXNzUnVsZShQZWVyLmFueUlwdjQoKSwgUG9ydC50Y3AoNDQzKSwgJ0hUVFBTIG91dGJvdW5kIGZvciBBV1MgQVBJIGNhbGxzJyk7XG5cbiAgICAgICAgcmV0dXJuIGxhbWJkYVNlY3VyaXR5R3JvdXA7XG4gICAgfVxufVxuIl19