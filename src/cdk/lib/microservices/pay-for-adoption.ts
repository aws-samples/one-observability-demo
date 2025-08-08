/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { Construct } from 'constructs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { ManagedPolicy, Policy, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { Utilities } from '../utils/utilities';
import { NagSuppressions } from 'cdk-nag';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';

export interface PayForAdoptionServiceProperties extends EcsServiceProperties {
    database: IDatabaseCluster;
    secret: ISecret;
    dynamoDbTable: ITable;
}

export class PayForAdoptionService extends EcsService {
    constructor(scope: Construct, id: string, properties: PayForAdoptionServiceProperties) {
        super(scope, id, properties);
    }

    addPermissions(properties: PayForAdoptionServiceProperties): void {
        properties.secret?.grantRead(this.taskRole);

        this.taskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        );

        this.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

        const taskPolicy = new Policy(this, 'taskPolicy', {
            policyName: 'PayForAdoptionTaskPolicy',
            document: new PolicyDocument({
                statements: [
                    EcsService.getDefaultSSMPolicy(this, PARAMETER_STORE_PREFIX),
                    EcsService.getDefaultDynamoDBPolicy(this, properties.dynamoDbTable.tableName),
                ],
            }),
            roles: [this.taskRole],
        });

        NagSuppressions.addResourceSuppressions(
            taskPolicy,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for the task role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Permissions are acceptable for the task role',
                },
            ],
            true,
        );

        NagSuppressions.addResourceSuppressions(
            this.taskRole,
            [
                {
                    id: 'AwsSolutions-IAM4',
                    reason: 'Managed Policies are acceptable for the task role',
                },
                {
                    id: 'AwsSolutions-IAM5',
                    reason: 'Permissions are acceptable for the task role',
                },
            ],
            true,
        );
    }

    createOutputs(properties: PayForAdoptionServiceProperties): void {
        if (this.service && !properties.disableService) {
            throw new Error('Service is not defined');
        } else {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        paymentapiurl: `http://${this.service?.loadBalancer.loadBalancerDnsName}/api/home/completeadoption`,
                        payforadoptionmetricsurl: `http://${this.service?.loadBalancer.loadBalancerDnsName}/metrics`,
                        cleanupadoptionsurl: `http://${this.service?.loadBalancer.loadBalancerDnsName}/api/home/cleanupadoptions`,
                    }),
                ),
            );
        }
    }
}
