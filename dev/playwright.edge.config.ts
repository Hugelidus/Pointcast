import { defineConfig } from "@playwright/test";
import chromiumConfig from "./playwright.config";

/**
 * The same end-to-end suite in headless Microsoft Edge (`pnpm e2e:edge`): the same e2e build,
 * specs, servers and ports as playwright.config.ts, so the two cannot run at the same time.
 * Only the browser differs, to prove pointcast works in Chromium browsers other than Chrome.
 * Playwright's "msedge" channel finds Edge where its installer puts it; the fixture adapts the
 * launch to Edge (dev/e2e/support/fixtures.ts).
 */
export default defineConfig(chromiumConfig, {
  use: { channel: "msedge" },
});
