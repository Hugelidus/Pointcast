import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, test as base, type BrowserContext, type Page } from "@playwright/test";
import { fakeMicrophoneFile } from "./fake-audio";
import { EXTENSION_DIR } from "./paths";

/**
 * Hosts that resolve to this machine only inside the test browser, so no request ever leaves it:
 * - myapp.test is a local dev host that must match (D8), but .test has no public DNS;
 * - not-local.example is served by the same local server but must NOT match.
 */
export const HOST_RESOLVER_RULES = "MAP myapp.test 127.0.0.1, MAP not-local.example 127.0.0.1";

interface Fixtures {
  /** WAV the fake microphone plays in a loop; defaults to es-short (fake-audio.ts). */
  microphoneFile: string | undefined;
  /** Temporary directory the browser downloads into; the real Downloads folder is never used. */
  downloadsDir: string;
  context: BrowserContext;
  extensionId: string;
  /** An open extension page (popup.html in a tab): has chrome.storage and chrome.downloads. */
  extensionPage: Page;
}

export const test = base.extend<Fixtures>({
  microphoneFile: [undefined, { option: true }],

  // Playwright's fixture API requires an object-destructuring first parameter.
  downloadsDir: async ({}, use) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pointcast-e2e-downloads-"));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },

  context: async ({ downloadsDir, microphoneFile }, use) => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "pointcast-e2e-profile-"));
    const userDataDir = path.join(tempDir, "profile");
    // The profile's own download folder is the temporary one (see useProfileDownloadFolder).
    mkdirSync(path.join(userDataDir, "Default"), { recursive: true });
    writeFileSync(
      path.join(userDataDir, "Default", "Preferences"),
      JSON.stringify({ download: { default_directory: downloadsDir, prompt_for_download: false } }),
    );

    const context = await chromium.launchPersistentContext(userDataDir, {
      // The "chromium" channel runs the full browser in new headless mode, which (unlike the
      // headless shell) supports extensions. Headless: no window opens on the desktop.
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      downloadsPath: downloadsDir,
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        "--mute-audio",
        // Grant getUserMedia without a prompt and feed it a file instead of a real microphone.
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${microphoneFile ?? fakeMicrophoneFile(tempDir)}`,
        `--host-resolver-rules=${HOST_RESOLVER_RULES}`,
      ],
    });
    await useProfileDownloadFolder(context, downloadsDir);
    await use(context);
    await context.close();
    rmSync(tempDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(new URL(worker.url()).host);
  },

  extensionPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await use(page);
  },
});

/**
 * Playwright's download handling (acceptDownloads) saves every file under a random name and
 * ignores the filename chrome.downloads asks for, so the Downloads/pointcast/<id>/ layout could
 * not be checked. Hand downloads back to Chrome's own logic, but only after proving that the
 * profile's default folder is the temporary one: a mistake here would write into ~/Downloads.
 */
async function useProfileDownloadFolder(context: BrowserContext, downloadsDir: string): Promise<void> {
  const settings = await context.newPage();
  await settings.goto("chrome://settings/downloads");
  const shown = (await settings.locator("#defaultDownloadPath").innerText()).trim();
  await settings.close();
  if (path.resolve(shown) !== path.resolve(downloadsDir)) {
    throw new Error(`Refusing to run: the profile would download into "${shown}", not "${downloadsDir}"`);
  }
  const browserSession = await context.browser()?.newBrowserCDPSession();
  if (!browserSession) throw new Error("persistent context without a browser CDP session");
  await browserSession.send("Browser.setDownloadBehavior", { behavior: "default" });
  await browserSession.detach();
}

export { expect } from "@playwright/test";
