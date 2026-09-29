const RETRYABLE = new Set(['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT']);

export const DEFAULT_RETRY_POLICY = {
  maxRetries: 5,
  initialMs: 500,
  maxMs: 10000,
  jitter: 0.1,
};

export function classifyHttpError(status, message = '') {
  if (status === 429) return 'RATE_LIMIT';
  if (status === 408 || status === 504) return 'TIMEOUT';
  if (status >= 500) return 'SERVER';
  if (!status) return 'TRANSPORT';
  const lower = String(message).toLowerCase();
  if (lower.includes('timeout')) return 'TIMEOUT';
  if (lower.includes('network') || lower.includes('fetch')) return 'TRANSPORT';
  return 'CLIENT';
}

export function retryDelayMs(attempt, policy = DEFAULT_RETRY_POLICY, retryAfterMs) {
  if (retryAfterMs && retryAfterMs > 0 && retryAfterMs <= policy.maxMs) return retryAfterMs;
  const exp = Math.min(policy.maxMs, policy.initialMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = exp * policy.jitter * Math.random();
  return Math.round(exp + jitter);
}

export function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

export async function withRetry(fn, {
  policy = DEFAULT_RETRY_POLICY,
  signal,
  onRetry,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Cancelled'), { status: 499, code: 'CANCELLED' });
    }
    try {
      const result = await fn();
      if (result == null || (typeof result === 'object' && result.empty)) {
        throw Object.assign(new Error('Empty model response'), { code: 'EMPTY_RESPONSE' });
      }
      return result;
    } catch (error) {
      lastError = error;
      const code = error.code || classifyHttpError(error.status, error.message);
      if (!RETRYABLE.has(code) || attempt >= policy.maxRetries) throw error;
      const wait = retryDelayMs(attempt + 1, policy, error.retryAfterMs);
      await onRetry?.({ attempt: attempt + 1, code, wait, message: error.message });
      await sleep(wait, signal);
    }
  }
  throw lastError;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Cancelled'), { status: 499, code: 'CANCELLED' }));
    }, { once: true });
  });
}
