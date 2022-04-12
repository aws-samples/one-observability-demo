#!/usr/bin/env node
import 'source-map-support/register';
import { Services } from '../lib/services';
import { Applications } from '../lib/applications';
//import { EKSPetsite } from '../lib/ekspetsite'
import { App, Tags } from 'aws-cdk-lib';


const stackName = "Services";
const app = new App();

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

Tags.of(app).add("Workshop","true")
