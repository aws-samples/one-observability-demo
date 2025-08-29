/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

const AWSXRay = require('aws-xray-sdk-core');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const documentClient = DynamoDBDocumentClient.from(client);

exports.handler = async function (event) {
    var payload = JSON.parse(event.body);

    var availability = 'yes';
    if (payload.petavailability === undefined) {
        availability = 'no';
    }
    var parameters = {
        TableName: process.env.TABLE_NAME,
        Key: {
            pettype: payload.pettype,
            petid: payload.petid,
        },
        UpdateExpression: 'set availability = :r',
        ExpressionAttributeValues: {
            ':r': availability,
        },
        ReturnValues: 'UPDATED_NEW',
    };

    await updatePetadoptionsTable(parameters);

    console.log(
        'Updated petid: ' + payload.petid + ', pettype: ' + payload.pettype + ', to availability: ' + availability,
    );
    return { statusCode: 200, body: 'success' };
};

async function updatePetadoptionsTable(parameters) {
    try {
        const command = new UpdateCommand(parameters);
        const data = await documentClient.send(command);
        console.log(JSON.stringify(data, undefined, 2));
    } catch (error) {
        console.log(JSON.stringify(error, undefined, 2));
        throw error;
    }
}
