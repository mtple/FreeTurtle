export interface RetryOptions {
  maxRetries: number; // default 3
  baseDelayMs: number; // default 1000
  maxDelayMs: number; // default 30000
  timeoutMs: number; // default 30000
  retryOn?: (err: unknown) => boolean; // custom classifier
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  timeoutMs: 30000,
};

/**
 * Default classifier: retry on network errors, 429, 5xx.
 * Don't retry 4xx (except 429).
 */
export function isRetryable(err: unknown): boolean {
  if (err === null || err === undefined) return false;

  // Check for status/statusCode properties (HTTP errors)
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;

    const status =
      typeof obj.status === "number"
        ? obj.status
        : typeof obj.statusCode === "number"
          ? obj.statusCode
          : undefined;

    if (status !== undefined) {
      if (status === 429) return true; // rate limited
      if (status >= 500) return true; // server errors
      if (status >= 400 && status < 500) return false; // client errors (except 429)
    }

    // Check for response.status (e.g. fetch-style errors)
    if (
      typeof obj.response === "object" &&
      obj.response !== null
    ) {
      const resp = obj.response as Record<string, unknown>;
      const respStatus = typeof resp.status === "number" ? resp.status : undefined;
      if (respStatus !== undefined) {
        if (respStatus === 429) return true;
        if (respStatus >= 500) return true;
        if (respStatus >= 400 && respStatus < 500) return false;
      }
    }

    // Network errors (Node.js)
    const code = typeof obj.code === "string" ? obj.code : "";
    const networkCodes = [
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "ETIMEDOUT",
      "EPIPE",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
      "FETCH_ERROR",
    ];
    if (networkCodes.includes(code)) return true;
  }

  // Check error message for common network issues
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("socket hang up") ||
      msg.includes("fetch failed")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Wraps an async function with timeout + exponential backoff + jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: Partial<RetryOptions>,
): Promise<T> {
  const options: RetryOptions = { ...DEFAULT_OPTIONS, ...opts };
  const classifier = options.retryOn ?? isRetryable;

  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const result = await withTimeout(fn(), options.timeoutMs);
      return result;
    } catch (err) {
      lastError = err;

      // Don't retry if we've exhausted attempts
      if (attempt >= options.maxRetries) break;

      // Don't retry if the error isn't retryable
      if (!classifier(err)) break;

      // Exponential backoff with jitter
      const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt);
      const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);
      const jitteredDelay = cappedDelay * (0.5 + Math.random());

      await sleep(jitteredDelay);
    }
  }

  throw lastError;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
