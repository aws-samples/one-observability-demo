#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';

import { Services } from '../lib/services';
//import { EKSPetsite } from '../lib/ekspetsite'


const app = new cdk.App();

new Services(app, 'Services');

//new EKSPetsite(app, 'EKSPetsite')
