import type { BrowserContext, CDPSession, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import {
  PROCESSING_TIMEOUT_MS,
  readRecorder,
  readSavedSession,
  savedWav,
  sendDraftFromContentScript,
  setSettings,
  startFromPopup,
  stopFromPopup,
  SYNTHETIC_ELEMENT,
  waitForStatus,
} from "./support/recorder";

type RunningStatus = "stopped" | "starting" | "running" | "stopping";

/**
 * Watches and controls the extension's service worker through the DevTools protocol's
 * ServiceWorker domain. Playwright's own Worker handle does not report the worker stopping,
 * but the protocol reports every runningStatus change of every worker version.
 */
class ServiceWorkerControl {
  readonly #status = new Map<string, RunningStatus>();

  private constructor(readonly cdp: CDPSession) {}

  static async attach(context: BrowserContext, extensionPage: Page, extensionId: string): Promise<ServiceWorkerControl> {
    const cdp = await context.newCDPSession(extensionPage);
    const control = new ServiceWorkerControl(cdp);
    cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
      for (const v of versions) {
        if (v.scriptURL.startsWith(`chrome-extension://${extensionId}/`)) control.#status.set(v.versionId, v.runningStatus);
      }
    });
    await cdp.send("ServiceWorker.enable");
    await expect.poll(() => control.status()).toBe("running");
    return control;
  }

  /** "running" if any version of the extension's worker runs, else the status of the latest one. */
  status(): RunningStatus | undefined {
    const all = [...this.#status.values()];
    return all.includes("running") ? "running" : all.at(-1);
  }

  /** Same effect as Chrome stopping the idle worker after ~30 s (D6). */
  async stop(): Promise<void> {
    for (const versionId of this.#status.keys()) await this.cdp.send("ServiceWorker.stopWorker", { versionId });
    await expect.poll(() => this.status()).toBe("stopped");
  }
}

test("recording state survives the service worker being stopped", async ({
  context,
  extensionId,
  extensionPage: popup,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);
  await setSettings(popup, { keepAudio: true });
  const t0 = await startFromPopup(popup);
  expect(await popup.evaluate(() => chrome.action.getBadgeText({}))).toBe("REC");

  const worker = await ServiceWorkerControl.attach(context, popup, extensionId);
  await worker.stop();

  // Nothing was kept in service worker memory: storage still says recording, with the same t0,
  // and a freshly opened popup rebuilds its view from it.
  expect((await readRecorder(popup)).state).toEqual({ status: "recording", t0 });
  await popup.reload();
  await expect(popup.locator("#status")).toHaveText("Recording");
  await expect(popup.locator("#toggle")).toHaveText("Stop");

  // Reading storage and reopening the popup did not need the worker: it is still stopped.
  expect(worker.status()).toBe("stopped");

  // Events go straight to the offscreen recorder. Its event-count report then wakes a new
  // worker, which can only store the count if it finds "recording" in storage.
  const { result, atStart } = await sendDraftFromContentScript(context, app, extensionId, {
    gesture: "point",
    element: SYNTHETIC_ELEMENT,
  });
  expect(result).toEqual({ accepted: true, id: "e1" });
  await expect.poll(() => worker.status()).toBe("running");
  await expect(popup.locator("#events")).toHaveText("1");

  // Stop once more, so the Stop command itself is handled by a freshly started worker.
  await worker.stop();
  await app.waitForTimeout(300);
  const { stoppedAt, sessionId } = await stopFromPopup(popup);
  // "✓" for a moment once the Markdown is ready, then a clean icon.
  expect(await popup.evaluate(() => chrome.action.getBadgeText({}))).toBe("✓");
  await expect.poll(() => popup.evaluate(() => chrome.action.getBadgeText({})), { timeout: 10_000 }).toBe("");

  const saved = await readSavedSession(popup, downloadsDir, sessionId);
  const { session } = saved;
  expect(session.t0).toBe(t0);
  expect(session.events[0]?.tStart).toBe(atStart - t0);
  expect(Math.abs(savedWav(saved).durationMs - (stoppedAt - t0))).toBeLessThan(500);
});

test("processing finishes when the service worker is stopped in the middle of it", async ({
  context,
  extensionId,
  extensionPage: popup,
  downloadsDir,
}) => {
  await startFromPopup(popup);
  await popup.waitForTimeout(3_000);
  const worker = await ServiceWorkerControl.attach(context, popup, extensionId);
  await popup.locator("#toggle").click();
  await waitForStatus(popup, "processing");

  // The offscreen document keeps transcribing; its reports wake a new worker, which finds the
  // state in storage and saves the files (D6: nothing lives in service worker memory).
  await worker.stop();
  expect((await readRecorder(popup)).state.status).toBe("processing");
  const state = await waitForStatus(popup, "idle", PROCESSING_TIMEOUT_MS);
  expect(state.error).toBeUndefined();
  expect(state.lastResult?.copied).toBe(true);
  const saved = await readSavedSession(popup, downloadsDir, state.lastSessionId as string);
  expect(saved.markdown).toContain("# UI change requests");
});
