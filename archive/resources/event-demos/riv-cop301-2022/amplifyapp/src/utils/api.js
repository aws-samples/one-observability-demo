/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
import { Amplify } from 'aws-amplify';

const apiName = 'voteapi';

export async function vote(colorName) {
    const path = `/votes`;
    const requestBody = {
        body: {
            color: colorName,
        },
    };
    return await Amplify.API.post(apiName, path, requestBody);
    // await new Promise(r => setTimeout(r, 1000));
}
