/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Example showing how to use the ADOT Collector construct
 * This is for documentation purposes and shows the integration pattern
 */

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { AdotCollector } from '../lib/constructs/adot-collector';

export class AdotExampleStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Create a task role
        const taskRole = new Role(this, 'TaskRole', {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
        });

        // Create a task definition
        const taskDefinition = new FargateTaskDefinition(this, 'TaskDefinition', {
            cpu: 1024,
            memoryLimitMiB: 2048,
            taskRole: taskRole,
        });

        // Add the main application container
        taskDefinition.addContainer('app', {
            image: { bind: () => ({ imageName: 'my-app:latest' }) },
            memoryLimitMiB: 1024,
            cpu: 512,
            environment: {
                OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
                OTEL_SERVICE_NAME: 'my-service',
                OTEL_RESOURCE_ATTRIBUTES: 'service.name=my-service,service.version=1.0.0',
            },
        });

        // Add ADOT collector as sidecar
        const adotCollector = new AdotCollector(this, 'AdotCollector', {
            taskDefinition: taskDefinition,
            serviceName: 'my-service',
            cpu: 256,
            memoryLimitMiB: 512,
        });

        // The ADOT collector is now configured and ready to receive telemetry data
        // from the application container via OTLP and forward it to AWS X-Ray and CloudWatch
    }
}