/**
 * Utility function for handling AWS throttling errors with exponential backoff
 * Retries API calls with increasing delays when throttling errors occur
 */
export declare function throttlingBackOff<T>(callback: () => Promise<T>, maxRetries?: number, initialDelay?: number, maxDelay?: number): Promise<T>;
