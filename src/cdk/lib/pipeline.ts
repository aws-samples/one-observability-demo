/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface CDKPipelineProperties extends StackProps {
    configBucketName: string;
    branchName?: string;
    organizationName?: string;
    repositoryName?: string;
}

const defaults = {
    branchName: 'main',
    organizationName: 'aws-samples',
    repositoryName: 'one-observability-demo',
};

export class CDKPipeline extends Stack {
    constructor(scope: Construct, id: string, properties: CDKPipelineProperties) {
        super(scope, id, properties);

        properties = { ...properties, ...defaults };
    }
}
