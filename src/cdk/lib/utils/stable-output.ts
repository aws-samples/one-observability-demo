/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * CloudFormation outputs with predictable names.
 *
 * By default CDK derives an output's logical id from the construct path and appends a hash of
 * it, so `new CfnOutput(this, 'TdirKbBucket', ...)` inside a construct called `KnowledgeBase`
 * surfaces as `KnowledgeBaseTdirKbBucket2114C0EE`. That is fine for values only code reads via
 * `Fn.importValue`, but unusable for anything a human is told to look up: the name is unreadable,
 * and it changes if the construct is ever renamed or moved.
 *
 * The TDIR workshop needs the opposite property. Several values participants work with are
 * service-generated and cannot be written into documentation — knowledge base and data source
 * ids, the agent runtime log group, generated Lambda and topic names. Instructions therefore
 * have to say "use the value of output `TdirKbBucket`", which only works if that name is exact
 * and stable.
 *
 * @packageDocumentation
 */

import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Creates a {@link CfnOutput} whose logical id is exactly `name`, with no construct-path prefix
 * or hash appended.
 *
 * Overriding an output's logical id is safe: outputs are metadata rather than resources, so
 * changing one never replaces infrastructure. Names must be unique per stack, so prefer a
 * `Tdir`-prefixed name, or include the resource name for per-instance outputs.
 *
 * @param scope - construct the output belongs to
 * @param name - exact logical id to publish, and the name documentation will reference
 * @param value - value to output
 * @param description - shown in the console and in `describe-stacks` output
 */
export function stableCfnOutput(
    scope: Construct,
    name: string,
    properties: { value: string; description?: string },
): CfnOutput {
    const output = new CfnOutput(scope, name, properties);
    output.overrideLogicalId(name);
    return output;
}

/**
 * Shorthand for {@link stableCfnOutput} when only a value and description are needed.
 *
 * @param scope - construct the output belongs to
 * @param name - exact logical id to publish
 * @param value - value to output
 * @param description - shown in the console and in `describe-stacks` output
 */
export function stableOutput(scope: Construct, name: string, value: string, description?: string): CfnOutput {
    return stableCfnOutput(scope, name, { value, description });
}
