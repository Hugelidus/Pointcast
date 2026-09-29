import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { HANDOFF_PORT } from "../../../packages/core/src/handoff";

export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Output of `wxt build --mode e2e` (run by `pnpm e2e` before the tests): a build of its own, so
 * running the suite never replaces the production build a developer has loaded in Chrome.
 * It records clipboard writes and notifications instead of performing them, and downloads the
 * model from MODEL_PORT (packages/extension/src/build-env.ts, .env.e2e).
 */
export const EXTENSION_DIR = path.join(REPO_ROOT, "packages", "extension", ".output", "chrome-mv3-e2e");

/** Serves MODEL_CACHE_DIR to the e2e build, which is configured to fetch the model from here. */
export const MODEL_PORT = 5541;

/**
 * transformers.js' own cache in node_modules, filled when the CLI (Node) first loads a model:
 * Xenova/whisper-base/{config.json, onnx/encoder_model.onnx, …}. Serving it keeps the e2e suite
 * from downloading 294 MB from Hugging Face in every fresh browser profile.
 */
export const MODEL_CACHE_DIR = (() => {
  const fromTranscribe = createRequire(path.join(REPO_ROOT, "packages", "transcribe", "package.json"));
  const transformersEntry = fromTranscribe.resolve("@huggingface/transformers");
  return path.join(path.dirname(transformersEntry), "..", ".cache");
})();

export const MODEL_ID = "Xenova/whisper-base";

/** Spoken Spanish fixture from dev/scripts/tts; a generated tone is used when it is missing. */
export const FIXTURE_WAV = path.join(REPO_ROOT, "dev", "fixtures", "audio", "es-short.wav");

/** Two ports prove that the host match patterns do not pin a port (D8). */
export const PORT_A = 5511;
export const PORT_B = 5512;
/** The fake Vite dev server of dev-server.spec.ts (support/fake-vite.ts), started by the test itself. */
export const PORT_DEV_SERVER = 5513;
/** The real Vite dev server of dev/examples/react-dashboard (vite-react19.spec.ts), started by the test itself. */
export const PORT_VITE_REACT = 5514;

/**
 * Where the e2e build hands recordings to a pointcast MCP server (WXT_HANDOFF_PORT in .env.e2e,
 * D11). Only handoff.spec.ts listens here, with the real CLI or a fake receiver; every other spec
 * finds nobody and falls back to downloads. Never HANDOFF_PORT: that is where the user's own MCP
 * server receives from the user's real extension, and the suite must never meet either of them.
 */
export const PORT_HANDOFF: number = 5542;

// Checked when the suite loads, before any browser starts: a build that talked to HANDOFF_PORT
// would hand test recordings to whatever pointcast MCP server the developer has running.
if (PORT_HANDOFF === HANDOFF_PORT) throw new Error(`PORT_HANDOFF must not be ${HANDOFF_PORT}, the real extension's port`);
const E2E_ENV = path.join(REPO_ROOT, "packages", "extension", ".env.e2e");
if (!new RegExp(`^WXT_HANDOFF_PORT=${PORT_HANDOFF}\\s*$`, "m").test(readFileSync(E2E_ENV, "utf8"))) {
  throw new Error(`${E2E_ENV} must set WXT_HANDOFF_PORT=${PORT_HANDOFF}, the port the e2e suite listens on`);
}
