/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Stack, StackProps, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Utilities } from '../utils/utilities';

export interface ComputeProperties extends StackProps {
    /** Tags to apply to all resources in the stage */
    tags?: { [key: string]: string };
}

export class ComputeStage extends Stage {
    public stack: ComputeStack;
    constructor(scope: Construct, id: string, properties: ComputeProperties) {
        super(scope, id, properties);

        if (properties.tags) {
            Utilities.TagConstruct(this.stack, properties.tags);
        }
    }
}

export class ComputeStack extends Stack {
    constructor(scope: Construct, id: string, properties?: ComputeProperties) {
        super(scope, id, properties);
    }
}
