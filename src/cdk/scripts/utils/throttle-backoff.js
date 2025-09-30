"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.throttlingBackOff = throttlingBackOff;
/**
 * Utility function for handling AWS throttling errors with exponential backoff
 * Retries API calls with increasing delays when throttling errors occur
 */
async function throttlingBackOff(callback, maxRetries = 5, initialDelay = 500, maxDelay = 5000) {
    let retries = 0;
    let delay = initialDelay;
    while (true) {
        try {
            return await callback();
        }
        catch (error) {
            // Check if error is throttling-related
            const isThrottling = error instanceof Error &&
                (error.name === 'ThrottlingException' ||
                    error.name === 'TooManyRequestsException' ||
                    error.name === 'Throttling' ||
                    error.name === 'RequestLimitExceeded' ||
                    error.code === 'RequestThrottled' ||
                    error.message.includes('Rate exceeded'));
            if (!isThrottling || retries >= maxRetries) {
                throw error;
            }
            // Exponential backoff with jitter
            delay = Math.min(delay * 2, maxDelay);
            const jitter = Math.random() * (delay / 4);
            const waitTime = delay + jitter;
            // Log throttling for debugging
            console.log(`⏳ Throttling detected, retrying in ${Math.round(waitTime / 100) / 10}s... (Retry ${retries + 1}/${maxRetries})`);
            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            retries++;
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGhyb3R0bGUtYmFja29mZi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInRocm90dGxlLWJhY2tvZmYudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFJQSw4Q0EwQ0M7QUE5Q0Q7OztHQUdHO0FBQ0ksS0FBSyxVQUFVLGlCQUFpQixDQUNuQyxRQUEwQixFQUMxQixhQUFxQixDQUFDLEVBQ3RCLGVBQXVCLEdBQUcsRUFDMUIsV0FBbUIsSUFBSTtJQUV2QixJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUM7SUFDaEIsSUFBSSxLQUFLLEdBQUcsWUFBWSxDQUFDO0lBRXpCLE9BQU8sSUFBSSxFQUFFLENBQUM7UUFDVixJQUFJLENBQUM7WUFDRCxPQUFPLE1BQU0sUUFBUSxFQUFFLENBQUM7UUFDNUIsQ0FBQztRQUFDLE9BQU8sS0FBYyxFQUFFLENBQUM7WUFDdEIsdUNBQXVDO1lBQ3ZDLE1BQU0sWUFBWSxHQUNkLEtBQUssWUFBWSxLQUFLO2dCQUN0QixDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUsscUJBQXFCO29CQUNqQyxLQUFLLENBQUMsSUFBSSxLQUFLLDBCQUEwQjtvQkFDekMsS0FBSyxDQUFDLElBQUksS0FBSyxZQUFZO29CQUMzQixLQUFLLENBQUMsSUFBSSxLQUFLLHNCQUFzQjtvQkFDcEMsS0FBMkIsQ0FBQyxJQUFJLEtBQUssa0JBQWtCO29CQUN4RCxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDO1lBRWpELElBQUksQ0FBQyxZQUFZLElBQUksT0FBTyxJQUFJLFVBQVUsRUFBRSxDQUFDO2dCQUN6QyxNQUFNLEtBQUssQ0FBQztZQUNoQixDQUFDO1lBRUQsa0NBQWtDO1lBQ2xDLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLENBQUM7WUFDdEMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQzNDLE1BQU0sUUFBUSxHQUFHLEtBQUssR0FBRyxNQUFNLENBQUM7WUFFaEMsK0JBQStCO1lBQy9CLE9BQU8sQ0FBQyxHQUFHLENBQ1Asc0NBQXNDLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxHQUFHLEdBQUcsQ0FBQyxHQUFHLEVBQUUsZUFBZSxPQUFPLEdBQUcsQ0FBQyxJQUFJLFVBQVUsR0FBRyxDQUNuSCxDQUFDO1lBRUYsdUJBQXVCO1lBQ3ZCLE1BQU0sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQztZQUM5RCxPQUFPLEVBQUUsQ0FBQztRQUNkLENBQUM7SUFDTCxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVXRpbGl0eSBmdW5jdGlvbiBmb3IgaGFuZGxpbmcgQVdTIHRocm90dGxpbmcgZXJyb3JzIHdpdGggZXhwb25lbnRpYWwgYmFja29mZlxuICogUmV0cmllcyBBUEkgY2FsbHMgd2l0aCBpbmNyZWFzaW5nIGRlbGF5cyB3aGVuIHRocm90dGxpbmcgZXJyb3JzIG9jY3VyXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB0aHJvdHRsaW5nQmFja09mZjxUPihcbiAgICBjYWxsYmFjazogKCkgPT4gUHJvbWlzZTxUPixcbiAgICBtYXhSZXRyaWVzOiBudW1iZXIgPSA1LFxuICAgIGluaXRpYWxEZWxheTogbnVtYmVyID0gNTAwLFxuICAgIG1heERlbGF5OiBudW1iZXIgPSA1MDAwLFxuKTogUHJvbWlzZTxUPiB7XG4gICAgbGV0IHJldHJpZXMgPSAwO1xuICAgIGxldCBkZWxheSA9IGluaXRpYWxEZWxheTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IHVua25vd24pIHtcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGVycm9yIGlzIHRocm90dGxpbmctcmVsYXRlZFxuICAgICAgICAgICAgY29uc3QgaXNUaHJvdHRsaW5nID1cbiAgICAgICAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmXG4gICAgICAgICAgICAgICAgKGVycm9yLm5hbWUgPT09ICdUaHJvdHRsaW5nRXhjZXB0aW9uJyB8fFxuICAgICAgICAgICAgICAgICAgICBlcnJvci5uYW1lID09PSAnVG9vTWFueVJlcXVlc3RzRXhjZXB0aW9uJyB8fFxuICAgICAgICAgICAgICAgICAgICBlcnJvci5uYW1lID09PSAnVGhyb3R0bGluZycgfHxcbiAgICAgICAgICAgICAgICAgICAgZXJyb3IubmFtZSA9PT0gJ1JlcXVlc3RMaW1pdEV4Y2VlZGVkJyB8fFxuICAgICAgICAgICAgICAgICAgICAoZXJyb3IgYXMgeyBjb2RlPzogc3RyaW5nIH0pLmNvZGUgPT09ICdSZXF1ZXN0VGhyb3R0bGVkJyB8fFxuICAgICAgICAgICAgICAgICAgICBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdSYXRlIGV4Y2VlZGVkJykpO1xuXG4gICAgICAgICAgICBpZiAoIWlzVGhyb3R0bGluZyB8fCByZXRyaWVzID49IG1heFJldHJpZXMpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gRXhwb25lbnRpYWwgYmFja29mZiB3aXRoIGppdHRlclxuICAgICAgICAgICAgZGVsYXkgPSBNYXRoLm1pbihkZWxheSAqIDIsIG1heERlbGF5KTtcbiAgICAgICAgICAgIGNvbnN0IGppdHRlciA9IE1hdGgucmFuZG9tKCkgKiAoZGVsYXkgLyA0KTtcbiAgICAgICAgICAgIGNvbnN0IHdhaXRUaW1lID0gZGVsYXkgKyBqaXR0ZXI7XG5cbiAgICAgICAgICAgIC8vIExvZyB0aHJvdHRsaW5nIGZvciBkZWJ1Z2dpbmdcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgICAgICAgIGDij7MgVGhyb3R0bGluZyBkZXRlY3RlZCwgcmV0cnlpbmcgaW4gJHtNYXRoLnJvdW5kKHdhaXRUaW1lIC8gMTAwKSAvIDEwfXMuLi4gKFJldHJ5ICR7cmV0cmllcyArIDF9LyR7bWF4UmV0cmllc30pYCxcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIFdhaXQgYmVmb3JlIHJldHJ5aW5nXG4gICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCB3YWl0VGltZSkpO1xuICAgICAgICAgICAgcmV0cmllcysrO1xuICAgICAgICB9XG4gICAgfVxufVxuIl19