/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

import AWSXRay from 'aws-xray-sdk';
import AWS from 'aws-sdk';
const capturedAWS = AWSXRay.captureAWS(AWS);
const documentClient = new capturedAWS.DynamoDB.DocumentClient();

export const handler = async function (event) {
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
    await documentClient
        .update(parameters, function (error, data) {
            if (error) {
                console.log(JSON.stringify(error, undefined, 2));
            } else {
                console.log(JSON.stringify(data, undefined, 2));
                //  console.log("Updated petid: "+payload.petid +", pettype: "+payload.pettype+ " to availability: "+availability);
            }
        })
        .promise();
}
