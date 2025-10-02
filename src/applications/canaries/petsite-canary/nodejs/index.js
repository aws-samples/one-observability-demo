//Update to use the new petsite URL

var synthetics = require('Synthetics');
const log = require('SyntheticsLogger');
const AWSXRay = require('aws-xray-sdk-core');

const recordedScript = async function () {
    return await AWSXRay.captureAsyncFunc('canary-execution', async (subsegment) => {
        let page = await synthetics.getPage();

        const navigationPromise = page.waitForNavigation();

        // Try to read from SSM, fallback to environment variable
        let petsiteUrl = process.env.PETSITE_URL;
        const ssmParameterName = process.env.PETSITE_URL_PARAMETER_NAME || '/petstore/petsiteurl';

        // Attempt to read from SSM
        try {
            const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
            const ssm = AWSXRay.captureAWSv3Client(new SSMClient({}));
            const command = new GetParameterCommand({
                Name: ssmParameterName,
                WithDecryption: false,
            });
            const parameter = await ssm.send(command);

            if (parameter.Parameter && parameter.Parameter.Value) {
                petsiteUrl = parameter.Parameter.Value;
                log.info('Successfully retrieved petsite URL from SSM: ' + petsiteUrl);
            }
        } catch {
            log.info('SSM access failed, using environment variable URL: ' + petsiteUrl);
        }

        log.info('Starting canary execution with URL: ' + petsiteUrl);
        log.info('SSM Parameter to monitor: ' + ssmParameterName);

        try {
            await synthetics.executeStep('Goto_0', async function () {
                await page.goto(petsiteUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
            });

            await page.setViewport({ width: 1448, height: 857 });

            await synthetics.executeStep('Click_1', async function () {
                await page.waitForSelector('.pet-filters #Varieties_SelectedPetColor');
                await page.click('.pet-filters #Varieties_SelectedPetColor');
            });

            await synthetics.executeStep('Select_2', async function () {
                await page.select('.pet-filters #Varieties_SelectedPetColor', 'brown');
            });

            await synthetics.executeStep('Click_3', async function () {
                await page.waitForSelector('.pet-filters #Varieties_SelectedPetColor');
                await page.click('.pet-filters #Varieties_SelectedPetColor');
            });

            await synthetics.executeStep('Click_4', async function () {
                await page.waitForSelector('.pet-wrapper #searchpets');
                await page.click('.pet-wrapper #searchpets');
            });

            await navigationPromise;

            await synthetics.executeStep('Click_5', async function () {
                await page.waitForSelector('.container > .pet-items > .pet-item:nth-child(1) > form > .pet-button');
                await page.click('.container > .pet-items > .pet-item:nth-child(1) > form > .pet-button');
            });

            await navigationPromise;

            await synthetics.executeStep('Click_6', async function () {
                await page.waitForSelector('.row > .col-md-6 > .form-group > form > .btn');
                await page.click('.row > .col-md-6 > .form-group > form > .btn');
            });

            await navigationPromise;

            await synthetics.executeStep('Click_7', async function () {
                await page.waitForSelector('.row > .col-md-6 > .pet-items > div > .btn-primary');
                await page.click('.row > .col-md-6 > .pet-items > div > .btn-primary');
            });

            await navigationPromise;

            await synthetics.executeStep('Click_8', async function () {
                await page.waitForSelector('.row > .col-md-4:nth-child(1) > .card > .card-body > .btn-primary');
                await page.click('.row > .col-md-4:nth-child(1) > .card > .card-body > .btn-primary');
            });

            await synthetics.executeStep('Click_9', async function () {
                await page.waitForSelector('.pet-header > .container > .row > .col-lg-8 > a:nth-child(5)');
                await page.click('.pet-header > .container > .row > .col-lg-8 > a:nth-child(5)');
            });

            await navigationPromise;

            await synthetics.executeStep('Click_10', async function () {
                await page.waitForSelector('.row #payCheckoutBtn');
                await page.click('.row #payCheckoutBtn');
            });

            log.info(' canary execution completed successfully');
            if (subsegment) subsegment.close();
        } catch (error) {
            log.error(' canary execution failed: ' + error.message);
            if (subsegment) {
                subsegment.addError(error);
                subsegment.close(error);
            }
            throw error;
        }
    });
};
exports.handler = async () => {
    return await recordedScript();
};
