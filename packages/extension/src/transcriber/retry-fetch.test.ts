import { describe, expect, it, vi } from "vitest";
import { retryOn429 } from "./retry-fetch";

const response = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe("retryOn429", () => {
  it("waits and retries on 429, honoring Retry-After, then returns the answer", async () => {
    const fetchFn = vi
      .fn<(input: string | URL) => Promise<Response>>()
      .mockResolvedValueOnce(response(429, { "retry-after": "3" }))
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn(async (_ms: number) => undefined);

    const answer = await retryOn429(fetchFn, { sleep, baseDelayMs: 1_000 })("https://huggingface.co/x");
    expect(answer.status).toBe(200);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3_000, 2_000]);
  });

  it("gives up after the last retry and returns the 429", async () => {
    const fetchFn = vi.fn(async () => response(429));
    const answer = await retryOn429(fetchFn, { retries: 2, sleep: async () => undefined })("u");
    expect(answer.status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("returns any other status right away", async () => {
    const fetchFn = vi.fn(async () => response(404));
    const sleep = vi.fn(async () => undefined);
    expect((await retryOn429(fetchFn, { sleep })("u")).status).toBe(404);
    expect(sleep).not.toHaveBeenCalled();
  });
});
