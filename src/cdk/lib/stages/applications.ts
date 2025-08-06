/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Utilities } from '../utils/utilities';

export interface MicroserviceApplicationsProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
}

export class MicroservicesStage extends Stage {
    public stack: MicroservicesStack;
    constructor(scope: Construct, id: string, properties: MicroserviceApplicationsProperties) {
        super(scope, id, properties);

        this.stack = new MicroservicesStack(this, 'ComputeStack', properties);

        if (properties.tags) {
            Utilities.TagConstruct(this.stack, properties.tags);
        }
    }
}

export class MicroservicesStack extends Stack {
    constructor(scope: Construct, id: string, properties: MicroserviceApplicationsProperties) {
        super(scope, id, properties);
    }
}
