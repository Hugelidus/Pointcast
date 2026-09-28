import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { displayPath } from "../../packages/cli/src/handoff/store";
import { EXTENSION_ID } from "../../packages/core/src/handoff";
import { startFakeReceiver } from "./support/fake-receiver";
import { expect, test } from "./support/fixtures";
import { startPointcastMcp } from "./support/mcp";
import { PORT_A, PORT_HANDOFF } from "./support/paths";
import {
  PROCESSING_TIMEOUT_MS,
  readE2eRecords,
  readRecorder,
  readSavedSession,
  setSettings,
  startFromPopup,
  stopFromPopup,
  waitForStatus,
} from "./support/recorder";
import { INDICATOR, sleepUntil } from "./support/scenario";
import { assertSessionFile } from "./support/session-schema";

/**
 * Handoff to a running pointcast MCP server (D11): after Stop, the e2e build offers the recording
 * to 127.0.0.1:PORT_HANDOFF before Chrome's downloads. The first test runs the real
 * `pointcast mcp` there (support/mcp.ts), the second a fake that refuses uploads and shows what
 * the browser sent (support/fake-receiver.ts). The user's own MCP server and extension only use
 * 20547, which nothing here binds or contacts (paths.ts).
 */

const APP = `http://127.0.0.1:${PORT_A}`;
/** No recording in the suite can have this id, so a folder with it could only come from a page. */
const INJECTED = `http://127.0.0.1:${PORT_HANDOFF}/pointcast/v1/sessions/2099-01-01_00-00-00`;

test("a running MCP server gets the recording: no download, no dialog; after it exits, Chrome's downloads take over", async ({
  context,
  extensionId,
  extensionPage: popup,
  downloadsDir,
}) => {
  // Two recordings, each processed, plus the first model load of a fresh profile.
  test.setTimeout(240_000);
  // The manifest key is in the build, so the receiver accepts this extension out of the box.
  expect(extensionId).toBe(EXTENSION_ID);

  // The fake microphone speaks Spanish: a few seconds are too short for Whisper to be sure of the
  // language, and a guess would add a warning and keep the audio.
  await setSettings(popup, { language: "es" });
  const dir = mkdtempSync(path.join(os.tmpdir(), "pointcast-e2e-sessions-"));
  const mcp = await startPointcastMcp({ dir, port: PORT_HANDOFF });
  try {
    const app = await context.newPage();
    await app.goto(`${APP}/index.html`);
    const t0 = await startFromPopup(popup);
    await app.bringToFront();
    await expect(app.locator(INDICATOR)).toBeVisible();
    await app.locator("#export-btn").click({ modifiers: ["Alt"] });
    await expect.poll(async () => (await readRecorder(popup)).eventCount).toBe(1);
    await sleepUntil(t0 + 3_000);
    await popup.bringToFront();
    await popup.locator("#toggle").click();
    const state = await waitForStatus(popup, "idle", PROCESSING_TIMEOUT_MS);

    // ---- The server stored it, and Chrome downloaded nothing: no Save dialog was possible.
    expect(state.error).toBeUndefined();
    expect(state.warning).toBeUndefined();
    const sessionId = state.lastSessionId;
    if (!sessionId) throw new Error("stopped without a saved session");
    const handedOffTo = shownAs(path.join(dir, sessionId));
    expect(state.lastResult).toMatchObject({ sessionId, copied: true, handedOffTo });
    expect(state.lastResult?.downloadId).toBeUndefined();
    expect(await popup.evaluate(() => chrome.downloads.search({}))).toEqual([]);

    // Renamed into place: no .incoming-* staging folder is left next to it.
    expect(readdirSync(dir)).toEqual([sessionId]);
    const folder = path.join(dir, sessionId);
    expect(readdirSync(folder).sort()).toEqual(["session.json", "session.md", "words.json"]);
    const session: unknown = JSON.parse(readFileSync(path.join(folder, "session.json"), "utf8"));
    assertSessionFile(session);
    expect(session.id).toBe(sessionId);
    expect(session.events.map((e) => `${e.gesture} ${e.element.tag} «${e.element.text}»`)).toEqual(["point button «Export»"]);
    const markdown = readFileSync(path.join(folder, "session.md"), "utf8");
    // Its one log line per recording (stderr: stdout is the MCP channel), which may still be in the pipe.
    await expect.poll(() => mcp.stderr.some((line) => line.includes(`stored recording ${sessionId} in `))).toBe(true);

    const records = await readE2eRecords(popup);
    expect(records.filter((r) => r.kind === "clipboard")).toEqual([{ kind: "clipboard", text: markdown }]);
    const saved = `Copied. Paste it into your agent. Saved by the Pointcast MCP server to ${handedOffTo}`;
    expect(records.filter((r) => r.kind === "notification")).toEqual([{ kind: "notification", title: "Pointcast", message: saved }]);
    await expect(popup.locator("#message")).toHaveText("Copied. Paste it into your agent.");
    await expect(popup.locator("#where-label")).toHaveText("Sent to your agent's Pointcast MCP server");
    // The line shows the end of the folder; the whole of it is in the title.
    await expect(popup.locator("#where-path")).toHaveAttribute("title", handedOffTo);
    await expect(popup.locator("#where-path")).toContainText(sessionId);
    // Show in folder only reveals Chrome's downloads; Copy path offers the folder instead.
    await expect(popup.locator("#copy-again")).toBeVisible();
    await expect(popup.locator("#show-folder")).toBeHidden();
    await expect(popup.locator("#copy-path")).toBeVisible();

    // ---- The agent reads it through the same server's tools.
    const latest = await mcp.client.callTool({ name: "get_session", arguments: { id: "latest" } });
    expect(latest.isError).toBeFalsy();
    expect(latest.content[0]?.text).toContain(`# ${sessionId}\n`);

    // ---- Web pages cannot store a session, from a local origin or from any other site.
    const remote = await context.newPage();
    await remote.goto(`http://not-local.example:${PORT_A}/index.html`);
    for (const page of [app, remote]) {
      expect(await tryToInject(page), page.url()).toEqual({ beacon: true, noCors: "answered", withHeaders: "rejected" });
    }
    // A beacon has nothing to await; it went first, and two round trips to the same server followed.
    await popup.waitForTimeout(500);
    expect(readdirSync(dir)).toEqual([sessionId]);

    // ---- The server exits with the agent: the port closes, and the next Stop downloads, silently.
    await mcp.close();
    await startFromPopup(popup);
    await popup.waitForTimeout(3_000);
    const next = await stopFromPopup(popup);
    await readSavedSession(popup, downloadsDir, next.sessionId);
    expect(next.state.warning).toBeUndefined();
    expect(readdirSync(dir)).toEqual([sessionId]);
  } finally {
    // Idempotent; after a failure, the test's own error is the one worth reporting.
    await mcp.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fallbacks: setting off makes no request; a refusing server gets a warning; the requests are clean", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  // Two recordings, each processed, plus the first model load of a fresh profile.
  test.setTimeout(240_000);
  const fake = await startFakeReceiver({ port: PORT_HANDOFF, upload: 500 });
  try {
    // A language that is not the default (and the fake microphone's, so Whisper need not guess
    // it from a few seconds), shown by the popup once it loads the settings again.
    await setSettings(popup, { language: "es" });
    await popup.reload();
    await expect(popup.locator("#language")).toHaveValue("es");

    // ---- Off in the popup: Chrome's downloads save it, and the server does not even get a hello.
    await popup.locator("details.settings > summary").click();
    const handoff = popup.locator("#handoff");
    await expect(handoff).toBeChecked();
    await handoff.uncheck();
    // The popup writes all four fields: turning this off must not reset the others.
    await expect.poll(() => storedSettings(popup)).toEqual({ language: "es", keepAudio: false, notify: true, handoff: false });
    await startFromPopup(popup);
    await popup.waitForTimeout(3_000);
    const off = await stopFromPopup(popup);
    await readSavedSession(popup, downloadsDir, off.sessionId);
    expect(off.state.warning).toBeUndefined();
    expect(fake.requests).toEqual([]);

    // ---- A cookie for 127.0.0.1: cookies ignore the port, so a request sent with credentials
    // would carry it to the receiver.
    const app = await context.newPage();
    await app.goto(`${APP}/index.html`);
    await app.evaluate(() => {
      document.cookie = "probe=1; path=/";
    });
    expect((await context.cookies(`http://127.0.0.1:${PORT_HANDOFF}/`)).map((c) => c.name)).toContain("probe");
    await popup.bringToFront();
    await handoff.check();
    await expect.poll(async () => (await storedSettings(popup))?.["handoff"]).toBe(true);

    // ---- On: the server says hello, then refuses the upload. Chrome's downloads save it, and the
    // popup says why.
    await startFromPopup(popup);
    await popup.waitForTimeout(3_000);
    await popup.locator("#toggle").click();
    const state = await waitForStatus(popup, "idle", PROCESSING_TIMEOUT_MS);
    expect(state.error).toBeUndefined();
    const sessionId = state.lastSessionId;
    if (!sessionId) throw new Error("stopped without a saved session");
    const saved = await readSavedSession(popup, downloadsDir, sessionId);
    const reason =
      "Not sent to the Pointcast MCP server: it refused this recording (disk full (test)). Your agent won't find it there, so paste it instead.";
    expect(state.warning).toBe(reason);
    // Still a success, with the warning apart from it (amber, never the error's red).
    await expect(popup.locator("#message")).toHaveText("Copied. Paste it into your agent.");
    await expect(popup.locator("#where-path")).toHaveText(sessionId);
    // What happened in bold, then what to do (popup/view.ts splitLead).
    await expect(popup.locator("#warning-lead")).toHaveText("Not sent to the Pointcast MCP server.");
    await expect(popup.locator("#warning-body")).toHaveText(
      "It refused this recording (disk full (test)). Your agent won't find it there, so paste it instead.",
    );

    // ---- Exactly a hello and one upload, from this extension, with no cookie and no preflight.
    expect(fake.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST /pointcast/v1/hello",
      `POST /pointcast/v1/sessions/${sessionId}`,
    ]);
    for (const { headers } of fake.requests) {
      expect(headers["origin"]).toBe(`chrome-extension://${EXTENSION_ID}`);
      expect(headers["x-pointcast-handoff"]).toBe("1");
      expect(headers["cookie"]).toBeUndefined();
    }
    // The body is the files back to back: the same bytes Chrome's downloads then saved.
    const [, upload] = fake.requests;
    if (!upload) throw new Error("no upload");
    const names = ["session.json", "words.json", "session.md"];
    const sizes = names.map((name) => statSync(path.join(saved.folder, name)).size);
    expect(upload.headers["content-type"]).toBe("application/octet-stream");
    expect(upload.headers["x-pointcast-files"]).toBe(names.map((name, i) => `${name}=${sizes[i]}`).join(","));
    expect(upload.headers["content-length"]).toBe(String(sizes.reduce((sum, size) => sum + size, 0)));
  } finally {
    await fake.close();
  }
});

/** The folder as the receiver reports it: its own displayPath ("~" inside home, "…" plus the last two segments outside it), so the OS user name never reaches chrome.storage.session (D8). */
function shownAs(folder: string): string {
  return displayPath(folder);
}

async function storedSettings(popup: Page): Promise<Record<string, unknown> | undefined> {
  return (await popup.evaluate(() => chrome.storage.local.get("settings")))["settings"] as Record<string, unknown> | undefined;
}

/**
 * What any web page can send to the receiver: a beacon and a no-cors POST (neither is
 * preflighted, so both reach it and are refused), and a POST with the extension's header and
 * content type, which needs a preflight the receiver refuses, so it is never sent.
 */
function tryToInject(page: Page): Promise<{ beacon: boolean; noCors: string; withHeaders: string }> {
  return page.evaluate(async (url) => {
    const outcome = (request: Promise<Response>) => request.then(() => "answered", () => "rejected");
    const beacon = navigator.sendBeacon(url, "x");
    const noCors = await outcome(fetch(url, { method: "POST", mode: "no-cors", body: "x" }));
    const withHeaders = await outcome(
      fetch(url, { method: "POST", headers: { "X-Pointcast-Handoff": "1", "Content-Type": "application/octet-stream" }, body: "x" }),
    );
    return { beacon, noCors, withHeaders };
  }, INJECTED);
}
