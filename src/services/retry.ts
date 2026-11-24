export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes an async operation with exponential backoff retries.
 */
export async function withExponentialBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = { maxAttempts: 3, baseDelayMs: 50 },
): Promise<RetryOutcome<T>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < options.maxAttempts) {
        const delayMs = options.baseDelayMs * 2 ** (attempt - 1);
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}
