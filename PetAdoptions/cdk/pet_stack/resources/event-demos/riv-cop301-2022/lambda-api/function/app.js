const AWSXRay = require('aws-xray-sdk-core')
const AWS = AWSXRay.captureAWS(require('aws-sdk'))

const sqs = new AWS.SQS()
const queueURL = process.env.QUEUE_URL
let response;

/**
 * Lambda Function URL
 * https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html
 */
exports.lambdaHandler = async (event, context) => {

    console.info(event)
    //let body = Buffer.from(event.body, 'base64')
    let body = atob(event.body)
    //let parsedVote = JSON.parse(body)

    console.log(
        event.requestContext.http.method,
        event.requestContext.http.path,
        event.requestContext.http.protocol,
        event.requestContext.http.userAgent,
        event.requestContext.http.sourceIp,
        body
    )

    if (event.requestContext.http.method == "POST" && event.requestContext.http.path == "/votes") {

        return this.enqueueVote(body, event.requestContext.http.sourceIp)
    }

    return { statusCode: 404 }
};

exports.enqueueVote = async (body, sourceIP) => {
    const params = {
        MessageBody: body,
        QueueUrl: queueURL,
    }

    let parsedVote = JSON.parse(body)

    return new Promise((resolve, reject) => {
        sqs.sendMessage(params, (err, data) => {
            if (err)
                throw err
            else {
                console.info(data)
                response = {
                    statusCode: 200,
                    headers: {
                        "Access-Control-Allow-Headers": "Content-Type",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
                    },
                    body: {
                        color: parsedVote.color.trim(),
                        source: sourceIP
                    }
                }
                resolve(response)
            }
        }).promise()
    })
}