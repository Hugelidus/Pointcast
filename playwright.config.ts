import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import { MODEL_CACHE_DIR, MODEL_ID, MODEL_PORT, PORT_A, PORT_B } from "./e2e/support/paths";

/**
 * End-to-end tests of the e2e build of the extension in headless Chromium (`pnpm e2e` builds it
 * first). The playground is served on two ports to prove host matching ignores the port (D8).
 */

// Stop → Markdown runs Whisper in the extension. The model comes from node_modules (MODEL_PORT
// below), never from Hugging Face; without it every processing test would fail slowly.
const encoder = path.join(MODEL_CACHE_DIR, MODEL_ID, "onnx", "encoder_model.onnx");
if (!existsSync(encoder)) {
  throw new Error(
    `The e2e suite serves ${MODEL_ID} from ${MODEL_CACHE_DIR}, but it is not there. ` +
      `Download it once (294 MB) with "node scripts/download-model.mjs".`,
  );
}

export default defineConfig({
  testDir: "e2e",
  // Each test launches its own browser with fake media devices; running them one at a time
  // keeps the machine responsive and avoids competing for the fixed ports.
  workers: 1,
  fullyParallel: false,
  // Every Stop now transcribes: a fresh profile loads the model (294 MB from the local server)
  // before Whisper runs, several seconds per recording.
  timeout: 120_000,
  forbidOnly: !!process.env["CI"],
  reporter: [["list"]],
  webServer: [
    ...[PORT_A, PORT_B].map((port) => ({
      // Bound to "::" so the same server answers on 127.0.0.1, localhost and [::1] (Node's
      // IPv6 sockets are dual-stack by default). -c-1 disables caching; -s keeps logs quiet.
      command: `node node_modules/http-server/bin/http-server playground -p ${port} -a :: -c-1 -s`,
      url: `http://127.0.0.1:${port}/index.html`,
      // Never test against some other server that happens to be on these ports.
      reuseExistingServer: false,
      timeout: 20_000,
    })),
    {
      // The e2e build's model host (.env.e2e). --cors: the offscreen document is cross-origin
      // isolated (COEP require-corp), so cross-origin responses need CORS headers.
      command: `node node_modules/http-server/bin/http-server "${MODEL_CACHE_DIR}" -p ${MODEL_PORT} -a 127.0.0.1 --cors -c-1 -s`,
      url: `http://127.0.0.1:${MODEL_PORT}/${MODEL_ID}/config.json`,
      reuseExistingServer: false,
      timeout: 20_000,
    },
  ],
});
