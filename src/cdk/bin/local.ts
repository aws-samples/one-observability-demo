/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { App } from 'aws-cdk-lib';
import { CoreStack } from '../lib/stages/core';
import { CORE_PROPERTIES, TAGS } from './environment';

const app = new App();

new CoreStack(app, 'CoreStack', {
    ...CORE_PROPERTIES,
    tags: TAGS,
});
