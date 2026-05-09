import logger from '../logger';

export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoff: 'linear' | 'exponential';
  onRetry?: (attempt: number, error: Error) => void;
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  const { maxAttempts, delayMs, backoff, onRetry } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (error instanceof PermanentError) {
        logger.error('Permanent error, not retrying', { error: error.message });
        throw error;
      }

      if (attempt === maxAttempts) {
        logger.error('Max retry attempts reached', { attempts: maxAttempts, error: error.message });
        throw error;
      }

      const waitMs = backoff === 'exponential'
        ? delayMs * Math.pow(2, attempt - 1)
        : delayMs * attempt;

      logger.warn('Retryable error, will retry', {
        attempt,
        maxAttempts,
        waitMs,
        error: error.message,
      });

      onRetry?.(attempt, error);
      await sleep(waitMs);
    }
  }

  throw new Error('Unreachable');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
