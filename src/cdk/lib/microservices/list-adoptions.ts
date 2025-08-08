/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ManagedPolicy, Policy, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';

export interface ListAdoptionsServiceProperties extends EcsServiceProperties {
    database: IDatabaseCluster;
    secret: ISecret;
}

export class ListAdoptionsService extends EcsService {
    constructor(scope: Construct, id: string, properties: ListAdoptionsServiceProperties) {
        super(scope, id, properties);
    }

    addPermissions(): void {
        this.taskDefinition.taskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('AmazonECSTaskExecutionRolePolicy'),
        );

        this.taskDefinition.taskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        );

        const taskPolicy = new Policy(this, 'taskPolicy', {
            policyName: 'ListdoptionTaskPolicy',
            document: new PolicyDocument({
                statements: [EcsService.getDefaultSSMPolicy(this, PARAMETER_STORE_PREFIX)],
            }),
            roles: [this.taskDefinition.taskRole],
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
            this.taskDefinition.taskRole,
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

    createOutputs(properties: ListAdoptionsServiceProperties): void {
        if (this.service && !properties.disableService) {
            throw new Error('Service is not defined');
        } else {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        petlistadoptionsurl: `http://${this.service?.loadBalancer.loadBalancerDnsName}/api/adoptionlist/`,
                        petlistadoptionsmetricsurl: `http://${this.service?.loadBalancer.loadBalancerDnsName}/metrics`,
                    }),
                ),
            );
        }
    }
}
