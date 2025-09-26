/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
var synthetics = require('Synthetics');
const log = require('SyntheticsLogger');
const https = require('node:https');
const http = require('node:http');

const apiCanaryBlueprint = async function () {
    const postData = '';

    const verifyRequest = async function (requestOption) {
        return new Promise((resolve, reject) => {
            log.info('Making request with options: ' + JSON.stringify(requestOption));
            let request;
            request = requestOption.port === 443 ? https.request(requestOption) : http.request(requestOption);
            request.on('response', (res) => {
                log.info(`Status Code: ${res.statusCode}`);
                log.info(`Response Headers: ${JSON.stringify(res.headers)}`);
                if (res.statusCode !== 200) {
                    reject('Failed: ' + requestOption.path);
                }
                res.on('data', (d) => {
                    log.info('Response: ' + d.length);
                    if (d.length <= 2) {
                        reject('PetType Invalid - : ' + requestOption.path);
                    }
                });
                res.on('end', () => {
                    resolve();
                });
            });

            request.on('error', (error) => {
                reject(error);
            });

            if (postData) {
                request.write(postData);
            }
            request.end();
        });
    };

    const headers = {};
    headers['User-Agent'] = [synthetics.getCanaryUserAgentString(), headers['User-Agent']].join(' ');

    const pettypes = ['fish', 'bunny', 'puppy', 'kitten'];
    const position = Math.floor(Math.random() * Math.floor(4));

    const requestOptions = {
        hostname: '<ALB_HOST_NAME>',
        // Example- hostname: 'petsearch-live.us-east-1.elasticbeanstalk.com',
        port: 80,
        path: '/api/search?pettype=' + pettypes[position],
        method: 'GET',
    };

    requestOptions['headers'] = headers;
    await verifyRequest(requestOptions);
};

exports.handler = async () => {
    return await apiCanaryBlueprint();
};
