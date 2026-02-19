export interface RetryOptions<T> {
  maxAttempts: number;
  baseDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
  _valueType?: T;
}

export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: unknown;
  attempts: number;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions<T>
): Promise<RetryResult<T>> {
  const maxAttempts = options.maxAttempts > 0 ? options.maxAttempts : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await fn();
      return { success: true, value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && options.shouldRetry(error);

      if (!canRetry) {
        return { success: false, error, attempts: attempt };
      }

      if (options.onRetry) {
        options.onRetry(attempt, error);
      }

      const delay = options.baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: maxAttempts,
  };
}
