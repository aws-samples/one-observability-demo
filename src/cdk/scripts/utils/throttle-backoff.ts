/**
 * Utility function for handling AWS throttling errors with exponential backoff
 * Retries API calls with increasing delays when throttling errors occur
 */
export async function throttlingBackOff<T>(
    callback: () => Promise<T>,
    maxRetries: number = 5,
    initialDelay: number = 500,
    maxDelay: number = 5000,
): Promise<T> {
    let retries = 0;
    let delay = initialDelay;

    while (true) {
        try {
            return await callback();
        } catch (error: unknown) {
            // Check if error is throttling-related
            const isThrottling =
                error instanceof Error &&
                (error.name === 'ThrottlingException' ||
                    error.name === 'TooManyRequestsException' ||
                    error.name === 'Throttling' ||
                    error.name === 'RequestLimitExceeded' ||
                    (error as { code?: string }).code === 'RequestThrottled' ||
                    error.message.includes('Rate exceeded'));

            if (!isThrottling || retries >= maxRetries) {
                throw error;
            }

            // Exponential backoff with jitter
            delay = Math.min(delay * 2, maxDelay);
            const jitter = Math.random() * (delay / 4);
            const waitTime = delay + jitter;

            // Log throttling for debugging
            console.log(
                `⏳ Throttling detected, retrying in ${Math.round(waitTime / 100) / 10}s... (Retry ${retries + 1}/${maxRetries})`,
            );

            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            retries++;
        }
    }
}
