/**
 * Build-time values Vite puts in `import.meta.env` (WXT generates the rest in .wxt/types).
 * WXT_* values come from the `.env.<mode>` file of the build mode; see build-env.ts.
 */
interface ImportMetaEnv {
  /**
   * "production" for `wxt build` and the store uploads (`pnpm zip:store`), "e2e" for
   * `wxt build --mode e2e`, "test" under Vitest.
   */
  readonly MODE: string;
  readonly WXT_MODEL_HOST?: string;
  readonly WXT_MODEL_PATH_TEMPLATE?: string;
  readonly WXT_HANDOFF_PORT?: string;
}
