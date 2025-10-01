/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const https = require('node:https');

const ssmClient = new SSMClient({});

exports.handler = async (event) => {
    console.log('Traffic generator started:', JSON.stringify(event));

    const startTime = Date.now();
    const concurrentUsers = Number.parseInt(process.env.CONCURRENT_USERS || '50');
    const petsiteUrlParameterName = process.env.PETSITE_URL_PARAMETER_NAME || '/petstore/petsiteurl';

    let petsiteBaseUrl = process.env.PETSITE_URL;

    // Get petsite URL from SSM Parameter Store or environment variable
    try {
        const command = new GetParameterCommand({
            Name: petsiteUrlParameterName,
            WithDecryption: false,
        });
        const response = await ssmClient.send(command);
        if (response.Parameter && response.Parameter.Value) {
            petsiteBaseUrl = response.Parameter.Value;
            console.log('Successfully retrieved petsite URL from SSM:', petsiteBaseUrl);
        }
    } catch (error) {
        console.log('SSM access failed, using environment variable URL:', petsiteBaseUrl);
        console.log('Error details:', error.message);
    }

    if (!petsiteBaseUrl) {
        throw new Error('Petsite URL not found in environment variables or SSM Parameter Store');
    }

    console.log(`Generating traffic for ${concurrentUsers} concurrent users to base URL: ${petsiteBaseUrl}`);

    // Create promises for all user journeys
    const userPromises = [];
    for (let index = 0; index < concurrentUsers; index++) {
        userPromises.push(simulateUserJourney(petsiteBaseUrl, index + 1));
    }

    // Wait for all user journeys to complete
    const results = await Promise.allSettled(userPromises);

    // Count successful and failed journeys
    const successfulJourneys = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failedJourneys = results.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
    ).length;

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(
        `Overall traffic generation completed: ${successfulJourneys} successful, ${failedJourneys} failed in ${duration}ms`,
    );

    return {
        statusCode: 200,
        body: {
            message: 'Overall traffic generation completed',
            totalUsers: concurrentUsers,
            successfulJourneys,
            failedJourneys,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString(),
        },
    };
};

/**
 * Simulates a complete user journey through the pet adoption process
 * @param {string} petsiteBaseUrl - The base URL of the petsite
 * @param {number} userIndex - The user index (1-based)
 * @returns {Promise<{userId: string, success: boolean, message?: string}>}
 */
async function simulateUserJourney(petsiteBaseUrl, userIndex) {
    const userId = `user${String(userIndex).padStart(5, '0')}`;
    const petId = `00${Math.floor(Math.random() * 10)}`;
    const petType = ['puppy', 'kitten', 'bunny'][Math.floor(Math.random() * 3)];
    const petColor = ['brown', 'black', 'white'][Math.floor(Math.random() * 3)];
    const price = Math.floor(Math.random() * 200) + 50;
    const cutenessRate = Math.floor(Math.random() * 5) + 1;

    // Food IDs by pet type
    const foodIdsByType = {
        puppy: ['F233c473c', 'Fc7f447a1'],
        kitten: ['Ffb5ef0e2', 'F36a222eb', 'F3585a442'],
        bunny: ['F046a4eca', 'F57580f2e'],
    };

    // Select random food ID based on pet type
    const availableFoodIds = foodIdsByType[petType] || foodIdsByType.puppy;
    const randomFoodId = availableFoodIds[Math.floor(Math.random() * availableFoodIds.length)];

    const requests = [];

    try {
        // 1. Homepage request
        requests.push(makeHttpRequest(petsiteBaseUrl, 'GET', `Homepage for ${userId}`));

        // 2. Pet selection page with parameters
        const petSelectionUrl = `${petsiteBaseUrl}/?selectedPetType=${petType}&selectedPetColor=${petColor}&userId=${userId}`;
        requests.push(makeHttpRequest(petSelectionUrl, 'GET', `Pet Selection for ${userId}`));

        // 3. Pet adoption page
        const adoptionUrl = `${petsiteBaseUrl}/Adoption?userId=${userId}&petid=${petId}&pettype=${petType}&petcolor=${petColor}&price=${price}&cuteness_rate=${cutenessRate}`;
        requests.push(makeHttpRequest(adoptionUrl, 'GET', `Pet Adoption for ${userId}`));

        // 4. Payment page for pet adoption
        const paymentUrl = `${petsiteBaseUrl}/Payment?userId=${userId}&status=success&petType=${petType}&petId=${petId}`;
        requests.push(makeHttpRequest(paymentUrl, 'GET', `Payment for ${userId}`));

        // 5. Food service page - browse food for the adopted pet
        const foodServiceUrl = `${petsiteBaseUrl}/FoodService?userId=${userId}&petType=${petType}&petId=${petId}`;
        requests.push(makeHttpRequest(foodServiceUrl, 'GET', `Food Service for ${userId}`));

        // 6. Add food items to cart
        const addToCartUrl = `${petsiteBaseUrl}/FoodService/AddToCart`;
        const addToCartData = JSON.stringify({ foodId: randomFoodId, userId: userId });
        requests.push(makeHttpRequest(addToCartUrl, 'POST', `Add To Cart for ${userId}`, addToCartData));

        // 7. Check cart count
        const cartCountUrl = `${petsiteBaseUrl}/FoodService/GetCartCount?userId=${userId}`;
        requests.push(makeHttpRequest(cartCountUrl, 'GET', `Get Cart Count for ${userId}`));

        // 8. Remove some items from cart (simulate changing mind)
        const removeItemUrl = `${petsiteBaseUrl}/Checkout/RemoveItem`;
        const removeItemData = JSON.stringify({ userId: userId, food_id: randomFoodId });
        requests.push(makeHttpRequest(removeItemUrl, 'POST', `Remove Item for ${userId}`, removeItemData));

        // 9. Add different food items to cart
        const addToCartUrl2 = `${petsiteBaseUrl}/FoodService/AddToCart`;
        const addToCartData2 = JSON.stringify({ foodId: randomFoodId, userId: userId });
        requests.push(makeHttpRequest(addToCartUrl2, 'POST', `Add To Cart (2nd time) for ${userId}`, addToCartData2));

        // 10. Clear entire cart (simulate starting over)
        const clearCartUrl = `${petsiteBaseUrl}/Checkout/ClearCart`;
        const clearCartData = JSON.stringify({ userId: userId });
        requests.push(makeHttpRequest(clearCartUrl, 'POST', `Clear Cart for ${userId}`, clearCartData));

        // 11. Reorder items (fresh start with new selection)
        const addToCartUrl3 = `${petsiteBaseUrl}/FoodService/AddToCart`;
        const addToCartData3 = JSON.stringify({ foodId: randomFoodId, userId: userId });
        requests.push(makeHttpRequest(addToCartUrl3, 'POST', `Reorder Items for ${userId}`, addToCartData3));

        // 12. Checkout page - review items
        const checkoutUrl = `${petsiteBaseUrl}/Checkout?userId=${userId}`;
        requests.push(makeHttpRequest(checkoutUrl, 'GET', `Checkout for ${userId}`));

        // 13. Pay and checkout - complete the purchase
        const payAndCheckoutUrl = `${petsiteBaseUrl}/Checkout/PayAndCheckOut`;
        const payAndCheckoutData = JSON.stringify({
            payment_method: {
                CreditCard: {
                    card_number: '4111111111111111',
                    expiry_month: 12,
                    expiry_year: 2025,
                    cvv: '123',
                    cardholder_name: 'John Doe',
                },
            },
            shipping_address: {
                name: 'John Doe',
                street: '123 Main St',
                city: 'Seattle',
                state: 'WA',
                zip_code: '98101',
                country: 'USA',
            },
            billing_address: {
                name: 'John Doe',
                street: '123 Main St',
                city: 'Seattle',
                state: 'WA',
                zip_code: '98101',
                country: 'USA',
            },
            userId: userId,
        });
        requests.push(makeHttpRequest(payAndCheckoutUrl, 'POST', `Pay and Checkout for ${userId}`, payAndCheckoutData));

        // Execute all requests concurrently
        const results = await Promise.allSettled(requests);
        const failedRequests = results.filter((r) => r.status === 'rejected').length;

        if (failedRequests > 0) {
            console.warn(`User ${userId} journey completed with ${failedRequests} failed requests.`);
            return { userId, success: false, message: `${failedRequests} requests failed` };
        }

        console.log(`User ${userId} journey completed successfully.`);
        return { userId, success: true };
    } catch (error) {
        console.error(`User ${userId} journey failed:`, error.message);
        return { userId, success: false, message: error.message };
    }
}

/**
 * Makes an HTTP request with proper error handling and timeouts
 * @param {string} url - The URL to request
 * @param {string} method - The HTTP method (default: GET)
 * @param {string} description - Description for logging
 * @param {string} data - Request body data (for POST requests)
 * @returns {Promise<{statusCode: number, description: string, data: string}>}
 */
function makeHttpRequest(url, method = 'GET', description = 'Request', data = null) {
    return new Promise((resolve, reject) => {
        const headers = {
            'User-Agent': 'CloudWatchSynthetics/TrafficGenerator',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            Connection: 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        };

        // Add Content-Type and Content-Length for POST requests
        if (method === 'POST' && data) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(data);
        }

        const options = {
            method: method,
            headers: headers,
            timeout: 15_000, // 15 seconds timeout
        };

        const request = https.request(url, options, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                    console.log(`${description} completed with status: ${response.statusCode}`);
                    resolve({
                        statusCode: response.statusCode,
                        description: description,
                        data: data.slice(0, 100),
                    });
                } else {
                    console.error(`${description} failed with status: ${response.statusCode}`);
                    reject(new Error(`${description} failed with status: ${response.statusCode}`));
                }
            });
        });

        request.on('error', (error) => {
            console.error(`${description} failed:`, error.message);
            reject(error);
        });

        request.on('timeout', () => {
            console.error(`${description} timeout after 15 seconds`);
            request.destroy();
            reject(new Error(`${description} timeout`));
        });

        // Write data for POST requests
        if (method === 'POST' && data) {
            request.write(data);
        }

        request.end();
    });
}
