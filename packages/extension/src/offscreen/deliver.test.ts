import { describe, expect, it, vi } from "vitest";
import type { ProcessingResult } from "../messages";
import { deliver, failureReport, REPORT_ATTEMPTS, type SendReport } from "./deliver";

const RESULT: ProcessingResult = {
  files: [{ url: "blob:md", fileName: "session.md" }],
  markdown: "# spec",
  copied: true,
  audioMs: 12_000,
  timings: { loadMs: 1, transcribeMs: 2, audioMs: 12_000 },
};

function deps(send: SendReport) {
  return { send: vi.fn(send), wait: vi.fn(async (_ms: number) => undefined) };
}

describe("deliver", () => {
  it("reports once when the service worker answers", async () => {
    const d = deps(async () => ({ ok: true }));
    expect(await deliver("s", RESULT, d)).toBe(true);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.wait).not.toHaveBeenCalled();
  });

  it("retries, with growing waits, while the service worker restarts", async () => {
    let calls = 0;
    const d = deps(async () => {
      calls++;
      if (calls === 1) throw new Error("Receiving end does not exist");
      return calls === 2 ? undefined : { ok: true };
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await deliver("s", RESULT, d)).toBe(true);
    expect(d.send).toHaveBeenCalledTimes(3);
    expect(d.wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(d.send.mock.calls.every(([, result]) => result === RESULT)).toBe(true);
  });

  it("ends with a failure report without files or Markdown when no full report was taken", async () => {
    const d = deps(async (_id, result) => (result.files.length > 0 ? undefined : { ok: true }));
    expect(await deliver("s", RESULT, d)).toBe(true);
    expect(d.send).toHaveBeenCalledTimes(REPORT_ATTEMPTS + 1);
    const last = d.send.mock.calls.at(-1)?.[1];
    expect(last).toEqual({
      files: [],
      copied: true,
      audioMs: 12_000,
      error: "The recording was processed, but Pointcast could not save it. The Markdown is still on your clipboard.",
      errorDetail: `The service worker did not take the processed session after ${REPORT_ATTEMPTS} attempts.`,
    });
  });
});

describe("failureReport", () => {
  it("keeps a handed-off session handed off: its files are safe with the MCP server", () => {
    const handedOff: ProcessingResult = { ...RESULT, files: [], handedOff: { dir: "~/x" }, warning: "w" };
    expect(failureReport(handedOff)).toEqual({ files: [], copied: true, audioMs: 12_000, handedOff: { dir: "~/x" }, warning: "w" });
  });

  it("says nothing about the clipboard when nothing was copied", () => {
    expect(failureReport({ ...RESULT, copied: false }).error).toBe("The recording was processed, but Pointcast could not save it.");
  });
});
