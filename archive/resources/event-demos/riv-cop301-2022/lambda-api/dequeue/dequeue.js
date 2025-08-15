/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const AWSXRay = require('aws-xray-sdk-core');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));

const dynamodb = new AWS.DynamoDB();
const tableName = process.env.TABLE_NAME;

/**
 * Lambda Function URL
 * https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html
 */
exports.lambdaHandler = async (event, context) => {
    let votes = {};

    for (const record of event.Records) {
        const { body } = record;
        const vote = JSON.parse(body);
        if (votes[vote.color] === undefined) {
            votes[vote.color] = 1;
        } else {
            votes[vote.color] += 1;
        }
    }

    console.log(votes);

    return this.updateVotesDDB(votes);
};

exports.updateVotesDDB = async (votes) => {
    const colors = Object.keys(votes);
    console.log(colors);

    const bulkUpdatePromises = colors.map(async (c) => {
        const count = `${votes[c]}`;
        console.log(count);
        await dynamodb
            .updateItem(
                {
                    TableName: tableName,
                    Key: {
                        color: {
                            S: c,
                        },
                    },
                    UpdateExpression: 'ADD votes :inc',
                    ExpressionAttributeValues: {
                        ':inc': { N: count },
                    },
                    ReturnValues: 'ALL_NEW',
                },
                (error, data) => {
                    if (error) throw error;
                    else console.log(JSON.stringify(data));
                },
            )
            .promise();
    });

    return await Promise.all(bulkUpdatePromises);
};
