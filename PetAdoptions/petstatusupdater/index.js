'use strict';

var AWSXRay = require('aws-xray-sdk');
var AWS = AWSXRay.captureAWS(require('aws-sdk'));
var documentClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async function (event, context, callback) {
    var payload = JSON.parse(event.body);

    var availability = "yes";
    if (payload.petavailability === undefined) {
        availability = "no";
    }
    var params = {
        TableName: process.env.TABLE_NAME,
        Key: {
            "pettype": payload.pettype,
            "petid": payload.petid
        },
        UpdateExpression: "set availability = :r",
        ExpressionAttributeValues: {
            ":r": availability
        }, ReturnValues: "UPDATED_NEW"
    };

    await updatePetadoptionsTable(params);

    console.log("Updated petid: " + payload.petid + ", pettype: " + payload.pettype + ", to availability: " + availability);
    return { "statusCode": 200, "body": "success" };
};

async function updatePetadoptionsTable(params) {
    await documentClient.update(params, function (err, data) {
        if (err) {
            console.log(JSON.stringify(err, null, 2));
        } else {
            console.log(JSON.stringify(data, null, 2));
            //  console.log("Updated petid: "+payload.petid +", pettype: "+payload.pettype+ " to availability: "+availability);
        }
    }).promise();
}
