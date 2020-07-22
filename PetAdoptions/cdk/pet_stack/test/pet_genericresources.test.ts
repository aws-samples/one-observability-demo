import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import PetGenericresources = require('../lib/test_only/pet_genericresources');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new PetGenericresources.PetGenericresourcesStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
