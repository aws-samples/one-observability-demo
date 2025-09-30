/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const puppeteer = require('puppeteer-core');

const ssmClient = new SSMClient({});

exports.handler = async (event) => {
    console.log('Petsite traffic generator started:', JSON.stringify(event));
    
    const startTime = Date.now();
    let browser = null;
    
    try {
        // Get petsite URL from SSM Parameter Store
        let petsiteUrl = process.env.PETSITE_URL;
        const ssmParameterName = process.env.PETSITE_URL_PARAMETER_NAME || '/petstore/petsiteurl';
        
        try {
            const command = new GetParameterCommand({
                Name: ssmParameterName,
                WithDecryption: false,
            });
            const response = await ssmClient.send(command);
            if (response.Parameter && response.Parameter.Value) {
                petsiteUrl = response.Parameter.Value;
                console.log('Successfully retrieved petsite URL from SSM:', petsiteUrl);
            }
        } catch (error) {
            console.log('SSM access failed, using environment variable URL:', petsiteUrl);
            console.log('Error details:', error.message);
        }
        
        if (!petsiteUrl) {
            throw new Error('Petsite URL not found in environment variables or SSM Parameter Store');
        }
        
        console.log('Starting browser automation with URL:', petsiteUrl);
        
        // Launch browser
        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/opt/chrome/chrome',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1456, height: 857 });
        
        // Navigate to petsite
        console.log('Navigating to petsite...');
        await page.goto(petsiteUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Perform the same actions as the canary
        console.log('Clicking on first pet item...');
        await page.waitForSelector('.container > .pet-items > .pet-item:nth-child(1) > form > .pet-button', { timeout: 10000 });
        await page.click('.container > .pet-items > .pet-item:nth-child(1) > form > .pet-button');
        
        console.log('Clicking on second navigation link...');
        await page.waitForSelector('.pet-header > .container > .row > .col-lg-8 > a:nth-child(2)', { timeout: 10000 });
        await page.click('.pet-header > .container > .row > .col-lg-8 > a:nth-child(2)');
        
        console.log('Clicking on first card button...');
        await page.waitForSelector('.row > .col-md-4:nth-child(1) > .card > .card-body > .btn-primary', { timeout: 10000 });
        await page.click('.row > .col-md-4:nth-child(1) > .card > .card-body > .btn-primary');
        
        console.log('Clicking on second card button...');
        await page.waitForSelector('.row > .col-md-4:nth-child(2) > .card > .card-body > .btn-primary', { timeout: 10000 });
        await page.click('.row > .col-md-4:nth-child(2) > .card > .card-body > .btn-primary');
        
        console.log('Clicking on fifth navigation link...');
        await page.waitForSelector('.pet-header > .container > .row > .col-lg-8 > a:nth-child(5)', { timeout: 10000 });
        await page.click('.pet-header > .container > .row > .col-lg-8 > a:nth-child(5)');
        
        console.log('Clicking on checkout button...');
        await page.waitForSelector('.row #payCheckoutBtn', { timeout: 10000 });
        await page.click('.row #payCheckoutBtn');
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`Traffic generation completed successfully in ${duration}ms`);
        
        return {
            statusCode: 200,
            body: {
                message: 'Traffic generation completed successfully',
                duration: `${duration}ms`,
                userId: event.userId || 'unknown',
                invocationId: event.invocationId || 'unknown',
                timestamp: new Date().toISOString(),
            },
        };
        
    } catch (error) {
        console.error('Traffic generation failed:', error);
        
        return {
            statusCode: 500,
            body: {
                message: 'Traffic generation failed',
                error: error.message,
                userId: event.userId || 'unknown',
                invocationId: event.invocationId || 'unknown',
                timestamp: new Date().toISOString(),
            },
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};
