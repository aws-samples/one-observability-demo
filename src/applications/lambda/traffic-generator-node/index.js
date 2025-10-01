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

    // Process user journeys sequentially to maintain session state
    const allRequestResults = [];
    for (let index = 0; index < concurrentUsers; index++) {
        try {
            const result = await simulateUserJourney(petsiteBaseUrl, index + 1);
            allRequestResults.push(...result.requests);
        } catch (error) {
            console.error(`User journey ${index + 1} failed:`, error.message);
        }
    }

    // Aggregate results by URL and status code
    const urlStats = {};
    for (const request of allRequestResults) {
        const url = request.url;
        const statusCode = request.statusCode;

        if (!urlStats[url]) {
            urlStats[url] = {};
        }
        if (!urlStats[url][statusCode]) {
            urlStats[url][statusCode] = 0;
        }
        urlStats[url][statusCode]++;
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Log detailed statistics
    console.log(`\n=== TRAFFIC GENERATION RESULTS (${duration}ms) ===`);
    console.log(`Total requests fired: ${allRequestResults.length}`);
    console.log(`Total users: ${concurrentUsers}`);

    for (const url of Object.keys(urlStats)) {
        console.log(`\n${url}:`);
        for (const statusCode of Object.keys(urlStats[url])) {
            const count = urlStats[url][statusCode];
            const percentage = ((count / allRequestResults.length) * 100).toFixed(1);
            console.log(`  Status ${statusCode}: ${count} requests (${percentage}%)`);
        }
    }

    return {
        statusCode: 200,
        body: {
            message: 'Traffic generation completed with detailed URL statistics',
            totalRequests: allRequestResults.length,
            totalUsers: concurrentUsers,
            duration: `${duration}ms`,
            urlStatistics: urlStats,
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
    let failedRequests = 0;

    // Helper function to make request and track results
    const makeTrackedRequest = async (url, method, description, data) => {
        try {
            const result = await makeHttpRequest(url, method, description, data);
            requests.push({ url, method, statusCode: result.statusCode, duration: result.duration });
            return result;
        } catch (error) {
            console.error(`${description} failed:`, error.message);
            const statusCode = error.message.includes('status:')
                ? Number.parseInt(error.message.match(/status: (\d+)/)?.[1])
                : 0;
            requests.push({ url, method, statusCode, duration: 0 });
            failedRequests++;
            throw error;
        }
    };

    try {
        // 1. Homepage request - establish session
        try {
            await makeTrackedRequest(petsiteBaseUrl, 'GET', `Homepage for ${userId}`);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 2. Pet selection page with parameters
        try {
            const petSelectionUrl = `${petsiteBaseUrl}/?selectedPetType=${petType}&selectedPetColor=${petColor}&userId=${userId}`;
            await makeTrackedRequest(petSelectionUrl, 'GET', `Pet Selection for ${userId}`);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 3. Pet adoption page
        try {
            const adoptionUrl = `${petsiteBaseUrl}/Adoption?userId=${userId}&petid=${petId}&pettype=${petType}&petcolor=${petColor}&price=${price}&cuteness_rate=${cutenessRate}`;
            await makeTrackedRequest(adoptionUrl, 'GET', `Pet Adoption for ${userId}`);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 4. Payment page for pet adoption
        try {
            const paymentUrl = `${petsiteBaseUrl}/Payment?userId=${userId}&status=success&petType=${petType}&petId=${petId}`;
            await makeTrackedRequest(paymentUrl, 'GET', `Payment for ${userId}`);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 5. Food service page - browse food for the adopted pet
        try {
            const foodServiceUrl = `${petsiteBaseUrl}/FoodService?userId=${userId}&petType=${petType}&petId=${petId}`;
            await makeTrackedRequest(foodServiceUrl, 'GET', `Food Service for ${userId}`);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 6. Add food items to cart
        try {
            const addToCartUrl = `${petsiteBaseUrl}/FoodService/AddToCart`;
            const addToCartData = JSON.stringify({ foodId: randomFoodId, userId: userId });
            await makeTrackedRequest(addToCartUrl, 'POST', `Add To Cart for ${userId}`, addToCartData);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 7. Check cart count
        try {
            const cartCountUrl = `${petsiteBaseUrl}/FoodService/GetCartCount?userId=${userId}`;
            await makeTrackedRequest(cartCountUrl, 'GET', `Get Cart Count for ${userId}`);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 8. Remove some items from cart (simulate changing mind)
        try {
            const removeItemUrl = `${petsiteBaseUrl}/Checkout/RemoveItem`;
            const removeItemData = JSON.stringify({ userId: userId, food_id: randomFoodId });
            await makeTrackedRequest(removeItemUrl, 'POST', `Remove Item for ${userId}`, removeItemData);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 9. Add different food items to cart
        try {
            const addToCartUrl2 = `${petsiteBaseUrl}/FoodService/AddToCart`;
            const addToCartData2 = JSON.stringify({ foodId: randomFoodId, userId: userId });
            await makeTrackedRequest(addToCartUrl2, 'POST', `Add To Cart (2nd time) for ${userId}`, addToCartData2);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 10. Clear entire cart (simulate starting over)
        try {
            const clearCartUrl = `${petsiteBaseUrl}/Checkout/ClearCart`;
            const clearCartData = JSON.stringify({ userId: userId });
            await makeTrackedRequest(clearCartUrl, 'POST', `Clear Cart for ${userId}`, clearCartData);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 11. Reorder items (fresh start with new selection)
        try {
            const addToCartUrl3 = `${petsiteBaseUrl}/FoodService/AddToCart`;
            const addToCartData3 = JSON.stringify({ foodId: randomFoodId, userId: userId });
            await makeTrackedRequest(addToCartUrl3, 'POST', `Reorder Items for ${userId}`, addToCartData3);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 12. Checkout page - review items
        try {
            const checkoutUrl = `${petsiteBaseUrl}/Checkout?userId=${userId}`;
            await makeTrackedRequest(checkoutUrl, 'GET', `Checkout for ${userId}`);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        // 13. Pay and checkout - complete the purchase
        try {
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
            await makeTrackedRequest(payAndCheckoutUrl, 'POST', `Pay and Checkout for ${userId}`, payAndCheckoutData);
        } catch {
            // Error already handled by makeTrackedRequest
        }

        if (failedRequests > 0) {
            console.warn(`User ${userId} journey completed with ${failedRequests} failed requests.`);
            return { userId, success: false, message: `${failedRequests} requests failed`, requests };
        }

        console.log(`User ${userId} journey completed successfully.`);
        return { userId, success: true, requests };
    } catch (error) {
        console.error(`User ${userId} journey failed:`, error.message);
        return { userId, success: false, message: error.message, requests };
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
function makeHttpRequest(url, method = 'GET', description = 'Request', data) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

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
            timeout: 60_000, // Increased to 60 seconds timeout for slow AddToCart
        };

        const request = https.request(url, options, (response) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                const endTime = Date.now();
                const duration = endTime - startTime;

                if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
                    console.log(`${description} completed with status: ${response.statusCode} in ${duration}ms`);
                    resolve({
                        statusCode: response.statusCode,
                        description: description,
                        duration: duration,
                        data: data.slice(0, 100),
                    });
                } else {
                    console.error(`${description} failed with status: ${response.statusCode} in ${duration}ms`);
                    reject(new Error(`${description} failed with status: ${response.statusCode} in ${duration}ms`));
                }
            });
        });

        request.on('error', (error) => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            console.error(`${description} failed after ${duration}ms:`, error.message);
            reject(error);
        });

        request.on('timeout', () => {
            const endTime = Date.now();
            const duration = endTime - startTime;
            console.error(`${description} timeout after ${duration}ms (60 second limit)`);
            request.destroy();
            reject(new Error(`${description} timeout after ${duration}ms`));
        });

        // Write data for POST requests
        if (method === 'POST' && data) {
            request.write(data);
        }

        request.end();
    });
}
