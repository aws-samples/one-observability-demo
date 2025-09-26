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
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { ApplicationSignalsIntegration, PythonInstrumentationVersion } from '@aws-cdk/aws-applicationsignals-alpha';

export interface ListAdoptionsServiceProperties extends EcsServiceProperties {
    database: IDatabaseCluster;
    secret: ISecret;
}

export class ListAdoptionsService extends EcsService {
    constructor(scope: Construct, id: string, properties: ListAdoptionsServiceProperties) {
        super(scope, id, properties);

        new ApplicationSignalsIntegration(this, 'petlist-integration', {
            taskDefinition: this.taskDefinition,
            instrumentation: {
                sdkVersion: PythonInstrumentationVersion.V0_9_0,
            },
            serviceName: `${properties.name}-Service`,
            cloudWatchAgentSidecar: {
                containerName: 'ecs-cwagent',
                enableLogging: true,
                cpu: 256,
                memoryLimitMiB: 512,
            },
        });

        NagSuppressions.addResourceSuppressions(
            this.taskDefinition,
            [
                {
                    id: 'AwsSolutions-ECS7',
                    reason: 'False positive, the Application Signal container has logging enabled as a sidecar',
                },
                {
                    id: 'Workshop-CWL1',
                    reason: 'Cloudwatch Logs is not an exposed property for the Alpha',
                },
                {
                    id: 'Workshop-CWL2',
                    reason: 'Cloudwatch Logs is not an exposed property for the Alpha',
                },
            ],
            true,
        );

        Utilities.TagConstruct(this, {
            'app:owner': 'petstore',
            'app:project': 'workshop',
            'app:name': properties.name,
            'app:computType': properties.computeType,
            'app:hostType:': properties.hostType,
        });
    }

    addPermissions(properties: ListAdoptionsServiceProperties): void {
        properties.secret?.grantRead(this.taskRole);

        this.taskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        );

        this.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

        const taskPolicy = new Policy(this, 'taskPolicy', {
            policyName: 'ListdoptionTaskPolicy',
            document: new PolicyDocument({
                statements: [EcsService.getDefaultSSMPolicy(this, PARAMETER_STORE_PREFIX)],
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

    createOutputs(properties: ListAdoptionsServiceProperties): void {
        if (!this.loadBalancedService && !properties.disableService) {
            throw new Error('Service is not defined');
        } else {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.PET_LIST_ADOPTIONS_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/api/adoptionlist/`,
                        [SSM_PARAMETER_NAMES.PET_LIST_ADOPTIONS_METRICS_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/metrics`,
                    }),
                ),
            );
        }
    }
}
