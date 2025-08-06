/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { DatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { EcsService, EcsServiceProperties } from '../constructs/ecs-service';
import { Construct } from 'constructs';

export interface PayForAdoptionServiceProperties extends EcsServiceProperties {
    database: DatabaseCluster;
}

export class PayForAdoptionService extends EcsService {
    constructor(scope: Construct, id: string, properties: PayForAdoptionServiceProperties) {
        super(scope, id, properties);

        properties.database.secret?.grantRead(this.taskDefinition.taskRole);
    }
}
