/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
var synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const recordedScript = async function () {
    let page = await synthetics.getPage();

    const navigationPromise = page.waitForNavigation();

    // Try to read from SSM, fallback to environment variable
    let petsiteUrl = process.env.PETSITE_URL;
    const ssmParameterName = process.env.PETSITE_URL_PARAMETER_NAME || '/petstore/petsiteurl';

    // Attempt to read from SSM using built-in AWS SDK
    try {
        // Try to use the built-in AWS SDK that might be available
        if (typeof AWS === 'undefined') {
            // Fallback: try to require AWS SDK
            const AWS = require('aws-sdk');
            const ssm = new AWS.SSM();
            const parameter = await ssm
                .getParameter({
                    Name: ssmParameterName,
                    WithDecryption: false,
                })
                .promise();

            if (parameter.Parameter && parameter.Parameter.Value) {
                petsiteUrl = parameter.Parameter.Value;
                log.info('Successfully retrieved petsite URL from SSM: ' + petsiteUrl);
            }
        } else {
            const ssm = new AWS.SSM();
            const parameter = await ssm
                .getParameter({
                    Name: ssmParameterName,
                    WithDecryption: false,
                })
                .promise();

            if (parameter.Parameter && parameter.Parameter.Value) {
                petsiteUrl = parameter.Parameter.Value;
                log.info('Successfully retrieved petsite URL from SSM: ' + petsiteUrl);
            }
        }
    } catch (error) {
        log.info('SSM access failed, using environment variable URL: ' + petsiteUrl);
        log.info('Error details: ' + error.message);
    }

    log.info('Starting main canary execution with URL: ' + petsiteUrl);
    log.info('SSM Parameter to monitor: ' + ssmParameterName);

    await synthetics.executeStep('Goto_0', async function () {
        await page.goto(petsiteUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    });

    await page.setViewport({ width: 1456, height: 857 });

    await synthetics.executeStep('Click_1', async function () {
        await page.waitForSelector('.container > .pet-items > .pet-item:nth-child(1) > form > .pet-button');
        await page.click('.container > .pet-items > .pet-item:nth-child(1) > form > .pet-button');
    });

    await navigationPromise;

    await synthetics.executeStep('Click_2', async function () {
        await page.waitForSelector('.pet-header > .container > .row > .col-lg-8 > a:nth-child(2)');
        await page.click('.pet-header > .container > .row > .col-lg-8 > a:nth-child(2)');
    });

    await navigationPromise;

    await synthetics.executeStep('Click_3', async function () {
        await page.waitForSelector('.row > .col-md-4:nth-child(1) > .card > .card-body > .btn-primary');
        await page.click('.row > .col-md-4:nth-child(1) > .card > .card-body > .btn-primary');
    });

    await synthetics.executeStep('Click_4', async function () {
        await page.waitForSelector('.row > .col-md-4:nth-child(2) > .card > .card-body > .btn-primary');
        await page.click('.row > .col-md-4:nth-child(2) > .card > .card-body > .btn-primary');
    });

    await synthetics.executeStep('Click_5', async function () {
        await page.waitForSelector('.pet-header > .container > .row > .col-lg-8 > a:nth-child(5)');
        await page.click('.pet-header > .container > .row > .col-lg-8 > a:nth-child(5)');
    });

    await navigationPromise;

    await synthetics.executeStep('Click_6', async function () {
        await page.waitForSelector('.row #payCheckoutBtn');
        await page.click('.row #payCheckoutBtn');
    });
};
exports.handler = async () => {
    return await recordedScript();
};
