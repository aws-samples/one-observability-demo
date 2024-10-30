#!/usr/bin/env node
import 'source-map-support/register';
import { Services } from '../lib/stacks/services';
import { Applications } from '../lib/stacks/applications';
//import { EKSPetsite } from '../lib/ekspetsite'
import { App, Tags, Aspects } from 'aws-cdk-lib';
import { CDKPipeline } from '../lib/stacks/pipeline';
//import { AwsSolutionsChecks } from 'cdk-nag';


const stackName = "Services";
const app = new App();

const pipelineStack = new CDKPipeline(app, "Pipeline", {
  sourceBucketName: process.env.SOURCE_BUCKET_NAME!,
  branchName: process.env.GITHUB_BRANCH || "main",
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  }
});


Tags.of(app).add("Workshop","true")
//Aspects.of(stack).add(new AwsSolutionsChecks({verbose: true}));
//Aspects.of(applications).add(new AwsSolutionsChecks({verbose: true}));
