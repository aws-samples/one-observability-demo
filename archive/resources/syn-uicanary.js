/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
var synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const flowBuilderBlueprint = async function () {
    // INSERT URL here
    //let url = "http://petsite-1081345346.us-east-1.elb.amazonaws.com/";
    let url = '<WEBSITE_URL>';

    let page = await synthetics.getPage();

    // Navigate to the initial url
    await synthetics.executeStep('navigateToUrl', async function (timeoutInMillis = 30_000) {
        await page.goto(url, { waitUntil: ['load', 'networkidle0'], timeout: timeoutInMillis });
    });

    // Execute customer steps
    await synthetics.executeStep('customerActions', async function () {
        await page.waitForSelector("[id='searchpets']", { timeout: 30_000 });
        await page.click("[id='searchpets']");
        try {
            await synthetics.takeScreenshot('click', 'result');
        } catch (error) {
            synthetics.addExecutionError('Unable to capture screenshot.', error);
        }

        await page.waitForSelector("[id='seeadoptionlist']", { timeout: 30_000 });
        await page.click("[id='seeadoptionlist']");
        try {
            await synthetics.takeScreenshot('click', 'result');
        } catch (error) {
            synthetics.addExecutionError('Unable to capture screenshot.', error);
        }

        await page.waitForSelector("[id='performhousekeeping']", { timeout: 30_000 });
        await page.click("[id='performhousekeeping']");
        try {
            await synthetics.takeScreenshot('click', 'result');
        } catch (error) {
            synthetics.addExecutionError('Unable to capture screenshot.', error);
        }
    });
};

exports.handler = async () => {
    return await flowBuilderBlueprint();
};
