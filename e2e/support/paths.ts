import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

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
 * from downloading 291 MB from Hugging Face in every fresh browser profile.
 */
export const MODEL_CACHE_DIR = (() => {
  const fromTranscribe = createRequire(path.join(REPO_ROOT, "packages", "transcribe", "package.json"));
  const transformersEntry = fromTranscribe.resolve("@huggingface/transformers");
  return path.join(path.dirname(transformersEntry), "..", ".cache");
})();

export const MODEL_ID = "Xenova/whisper-base";

/** Spoken Spanish fixture from scripts/tts; a generated tone is used when it is missing. */
export const FIXTURE_WAV = path.join(REPO_ROOT, "fixtures", "audio", "es-short.wav");

/** Two ports prove that the host match patterns do not pin a port (D8). */
export const PORT_A = 5511;
export const PORT_B = 5512;
/** The fake Vite dev server of dev-server.spec.ts (support/fake-vite.ts), started by the test itself. */
export const PORT_DEV_SERVER = 5513;
