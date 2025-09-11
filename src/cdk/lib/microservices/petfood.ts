/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { Construct } from 'constructs';
import { ManagedPolicy, Policy, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { PARAMETER_STORE_PREFIX } from '../../bin/environment';
import { SSM_PARAMETER_NAMES } from '../../bin/constants';
import { NagSuppressions } from 'cdk-nag';
import { Utilities } from '../utils/utilities';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';

export interface PetFoodProperties extends EcsServiceProperties {
    petFoodTable: ITable;
    petFoodCartTable: ITable;
    assetsBucket: IBucket;
}

export class PetFoodECSService extends EcsService {
    constructor(scope: Construct, id: string, properties: PetFoodProperties) {
        super(scope, id, properties);

        // new ApplicationSignalsIntegration(this, 'petlist-integration', {
        //     taskDefinition: this.taskDefinition,
        //     instrumentation: {
        //         sdkVersion: RustInstr.V0_9_0,
        //     },
        //     serviceName: `${properties.name}-Service`,
        //     cloudWatchAgentSidecar: {
        //         containerName: 'ecs-cwagent',
        //         enableLogging: true,
        //         cpu: 256,
        //         memoryLimitMiB: 512,
        //     },
        // });

        // NagSuppressions.addResourceSuppressions(this.taskDefinition, [
        //     {
        //         id: 'AwsSolutions-ECS7',
        //         reason: 'False positive, the Application Signal container has logging enabled as a sidecar',
        //     },
        // ]);

        // Utilities.TagConstruct(this, {
        //     'app:owner': 'petstore',
        //     'app:project': 'workshop',
        //     'app:name': properties.name,
        //     'app:computType': properties.computeType,
        //     'app:hostType:': properties.hostType,
        // });
    }

    addPermissions(properties: PetFoodProperties): void {
        properties.petFoodTable.grantReadWriteData(this.taskRole);
        properties.petFoodCartTable.grantReadWriteData(this.taskRole);
        properties.assetsBucket.grantReadWrite(this.taskRole);

        this.taskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
        );

        this.taskRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'));

        const taskPolicy = new Policy(this, 'taskPolicy', {
            policyName: 'PetFoodTaskPolicy',
            document: new PolicyDocument({
                statements: [
                    EcsService.getDefaultSSMPolicy(this, PARAMETER_STORE_PREFIX),
                    EcsService.getDefaultEventBridgePolicy(this),
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

    createOutputs(properties: PetFoodProperties): void {
        if (!this.loadBalancedService && !properties.disableService) {
            throw new Error('Service is not defined');
        } else {
            Utilities.createSsmParameters(
                this,
                PARAMETER_STORE_PREFIX,
                new Map(
                    Object.entries({
                        [SSM_PARAMETER_NAMES.FOOD_API_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/api/foods`,
                        [SSM_PARAMETER_NAMES.PET_FOOD_METRICS_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/metrics`,
                        [SSM_PARAMETER_NAMES.PET_FOOD_CART_URL]: `http://${this.loadBalancedService?.loadBalancer.loadBalancerDnsName}/api/cart`,
                    }),
                ),
            );
        }
    }
}
