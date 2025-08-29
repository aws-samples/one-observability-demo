/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Observability Stage for the One Observability Workshop.
 *
 * This stage deploys monitoring and observability tools including:
 * - CloudWatch Synthetics Canaries for application monitoring
 * - Traffic generation Lambda functions for load testing
 * - EventBridge rules for scheduling
 * - S3 buckets for canary artifacts
 *
 * @packageDocumentation
 */

import { CfnOutput, Duration, Stack, Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CanaryStack } from '../constructs/canaries/canary-stack';

/**
 * Properties for configuring the Observability stage.
 */
export interface ObservabilityStageProps extends StageProps {
  /** Whether to enable traffic generation (default: true) */
  enableTrafficGeneration?: boolean;
  /** Number of concurrent users for main canary (default: 50) */
  mainConcurrentUsers?: number;
  /** Number of concurrent users for housekeeping canary (default: 20) */
  housekeepingConcurrentUsers?: number;
  /** Schedule for main canary (default: "rate(1 minute)") */
  mainSchedule?: string;
  /** Schedule for housekeeping canary (default: "rate(5 minutes)") */
  housekeepingSchedule?: string;
  /** Tags to apply to all resources in this stage */
  tags?: { [key: string]: string };
}

/**
 * Observability Stage that deploys monitoring and traffic generation tools.
 *
 * This stage runs after the microservices stage and provides:
 * - Application monitoring via CloudWatch Synthetics
 * - Automated traffic generation for load testing
 * - Housekeeping operations for demo resets
 */
export class ObservabilityStage extends Stage {
  /**
   * Creates a new Observability stage.
   *
   * @param scope - The parent construct
   * @param id - The construct identifier
   * @param properties - Configuration properties for the stage
   */
  constructor(scope: Construct, id: string, properties: ObservabilityStageProps = {}) {
    super(scope, id, properties);

    // Create the canary system stack
    new CanaryStack(this, 'CanarySystem', {
      // Enable traffic generation by default
      enableTrafficGeneration: properties.enableTrafficGeneration ?? true,
      
      // Main canary configuration
      mainConcurrentUsers: properties.mainConcurrentUsers ?? 50,
      mainSchedule: properties.mainSchedule ?? 'rate(1 minute)',
      
      // Housekeeping canary configuration
      housekeepingConcurrentUsers: properties.housekeepingConcurrentUsers ?? 20,
      housekeepingSchedule: properties.housekeepingSchedule ?? 'rate(5 minutes)',
      
      // Environment configuration
      env: properties.env,
      
      // Tags for resource management
      tags: properties.tags,
    });
  }
}
