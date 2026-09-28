type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RetryOptions {
  /** Retries after the first attempt. */
  retries?: number;
  /** First wait when the server gives no Retry-After; doubles on every retry. */
  baseDelayMs?: number;
  /** Longest single wait, whatever Retry-After says. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wraps fetch so a 429 (Too Many Requests) is waited out and retried instead of failing the
 * model download. Hugging Face rate-limits anonymous downloads now and then; the spike met it
 * once on a single file (dev/spikes/in-browser-whisper/worker.js). Honors Retry-After in seconds.
 * Any other status, and network errors, go back to the caller unchanged.
 */
export function retryOn429(fetchFn: Fetch, options: RetryOptions = {}): Fetch {
  const { retries = 4, baseDelayMs = 2_000, maxDelayMs = 60_000 } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchFn(input, init);
      if (response.status !== 429 || attempt >= retries) return response;
      const retryAfterS = Number(response.headers.get("retry-after"));
      const wait = retryAfterS > 0 ? retryAfterS * 1000 : baseDelayMs * 2 ** attempt;
      await sleep(Math.min(wait, maxDelayMs));
    }
  };
}
