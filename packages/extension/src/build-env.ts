import { HANDOFF_PORT as DEFAULT_HANDOFF_PORT } from "@pointcast/core";

/**
 * What differs between the real extension and the build the e2e suite loads
 * (`wxt build --mode e2e`, which reads `.env.e2e` and writes .output/chrome-mv3-e2e).
 *
 * The e2e build must never touch the machine it runs on: no real clipboard write, no real
 * notification, no file manager window, and no 294 MB model download from Hugging Face. Those
 * few side effects check IS_E2E and record what they would have done instead (e2e-record.ts).
 */
export const IS_E2E = import.meta.env.MODE === "e2e";

/**
 * Where Whisper's model files come from. Undefined means the library's default, the Hugging Face
 * Hub. The e2e build serves them from the local transformers.js cache over HTTP instead.
 */
export const MODEL_HOST = import.meta.env.WXT_MODEL_HOST || undefined;
export const MODEL_PATH_TEMPLATE = import.meta.env.WXT_MODEL_PATH_TEMPLATE || undefined;

/**
 * Where the offscreen document looks for a running pointcast MCP server to hand a recording to
 * (D11). The e2e build uses its own port (.env.e2e), so it never meets the user's real server.
 */
export const HANDOFF_PORT = Number(import.meta.env.WXT_HANDOFF_PORT) || DEFAULT_HANDOFF_PORT;
