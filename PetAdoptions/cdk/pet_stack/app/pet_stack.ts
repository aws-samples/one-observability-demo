#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';

import { Services } from '../lib/services';
import { Applications } from '../lib/applications';
//import { EKSPetsite } from '../lib/ekspetsite'

const stackName = "Services";
const app = new cdk.App();

const stack = new Services(app, stackName, { 
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
}});

const applications = new Applications(app, "Applications", {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
}});

cdk.Tags.of(stack).add('Workshop','true')
