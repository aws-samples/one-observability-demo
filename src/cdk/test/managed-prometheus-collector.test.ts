/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Unit tests for the ManagedPrometheusCollector construct.
 *
 * @packageDocumentation
 */

import { App, Aspects, Stack } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { SecurityGroup, Vpc } from 'aws-cdk-lib/aws-ec2';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ManagedPrometheusCollector } from '../lib/constructs/managed-prometheus-collector';
import { WorkshopNagPack } from '../lib/utils/workshop-nag-pack';

function synthCollector(): Stack {
    const app = new App();
    const stack = new Stack(app, 'TestStack', { env: { account: '123456789012', region: 'us-east-1' } });
    const vpc = new Vpc(stack, 'Vpc');
    new ManagedPrometheusCollector(stack, 'Collector', {
        vpc,
        securityGroup: new SecurityGroup(stack, 'SecurityGroup', { vpc }),
        privateSubnetIds: vpc.privateSubnets.map((subnet) => subnet.subnetId),
        cloudMapNamespaceName: 'test.local',
        targetServices: [{ name: 'payforadoption-go', port: 8080 }],
    });
    Aspects.of(app).add(new AwsSolutionsChecks());
    Aspects.of(app).add(new WorkshopNagPack());
    app.synth();
    return stack;
}

describe('ManagedPrometheusCollector', () => {
    const stack = synthCollector();
    const template = Template.fromStack(stack);

    test('CreateScraper custom resource does not delete the scraper itself', () => {
        // Deleting from the AwsCustomResource fails while the scraper is still CREATING (#618).
        const scrapers = template.findResources('Custom::AWS');
        expect(Object.keys(scrapers)).toHaveLength(1);
        for (const scraper of Object.values(scrapers)) {
            expect(scraper.Properties.Delete).toBeUndefined();
        }
    });

    test('deletion waiter receives the scraper ID', () => {
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
            ScraperId: { 'Fn::GetAtt': [Match.anyValue(), 'scraperId'] },
        });
    });

    test('deletion waiter has no cdk-nag errors', () => {
        // The VPC fixture and the AwsCustomResource singleton are suppressed at the app level in bin/.
        const errors = Annotations.fromStack(stack)
            .findError('*', Match.stringLikeRegexp('.*'))
            .filter((error) => error.id.startsWith('/TestStack/Collector/ScraperDeletionWaiter'));
        expect(errors.map((error) => `${error.id}: ${error.entry.data}`)).toEqual([]);
    });
});
