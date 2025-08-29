const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const lambda = new LambdaClient({});

exports.handler = async (event) => {
    console.log('Traffic generator started:', JSON.stringify(event));

    const canaryFunctionArn = process.env.CANARY_FUNCTION_ARN;
    const concurrentUsers = Number.parseInt(process.env.CONCURRENT_USERS || '50');

    console.log(`Generating traffic for ${concurrentUsers} concurrent users`);
    console.log(`Invoking canary function: ${canaryFunctionArn}`);

    const startTime = Date.now();
    const promises = [];

    // Create array of user IDs
    const userIds = Array.from({ length: concurrentUsers }, (_, index) => `user${String(index + 1).padStart(4, '0')}`);

    // Invoke canary function for each user concurrently
    for (let index = 0; index < concurrentUsers; index++) {
        const userId = userIds[index];

        const invokeParameters = {
            FunctionName: canaryFunctionArn,
            InvocationType: 'Event', // Async invocation
            Payload: JSON.stringify({
                userId: userId,
                invocationId: `${Date.now()}-${index}`,
                source: 'traffic-generator',
                timestamp: new Date().toISOString(),
            }),
        };

        console.log(`Invoking canary for user: ${userId}`);
        const command = new InvokeCommand(invokeParameters);
        promises.push(
            lambda
                .send(command)
                .then((result) => {
                    console.log(`Successfully invoked canary for user ${userId}`);
                    return { userId, success: true, result };
                })
                .catch((error) => {
                    console.error(`Failed to invoke canary for user ${userId}:`, error);
                    return { userId, success: false, error: error.message };
                }),
        );
    }

    // Wait for all invocations to complete
    console.log(`Waiting for \${concurrentUsers} canary invocations to complete...`);
    const results = await Promise.allSettled(promises);

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Analyze results
    const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
    ).length;

    console.log(`Traffic generation completed in ${duration}ms`);
    console.log(`Successful invocations: ${successful}`);
    console.log(`Failed invocations: ${failed}`);

    // Return summary
    return {
        statusCode: 200,
        body: {
            message: 'Traffic generation completed',
            totalUsers: concurrentUsers,
            successful,
            failed,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString(),
        },
    };
};
