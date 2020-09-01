#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';

import { Services } from '../lib/services';
import { EKS_Petsite } from '../lib/eks-petsite'


const app = new cdk.App();

new Services(app, 'Services');

new EKS_Petsite(app, 'EKS_Petsite')
