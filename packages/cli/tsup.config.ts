import { defineConfig } from "tsup";

/**
 * Bundles the CLI for `npx pointcast`: the workspace packages (@pointcast/core,
 * @pointcast/transcribe) are TS-source-only (their package.json "exports" point at src/index.ts
 * directly — fine inside this monorepo, where every consumer runs through tsx/vitest/tsc, but
 * useless to someone who just ran `npx pointcast`), so they are bundled in. `@huggingface/
 * transformers` (an optional peer dependency, see src/transcribe/index.ts) and
 * `@modelcontextprotocol/sdk` stay external (real npm packages, not source-only workspace
 * packages) so npm installs one copy instead of tsup duplicating a large ONNX runtime into dist/.
 * zod is external for the same reason.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // The local transcription engine is imported dynamically (src/transcribe/index.ts): splitting
  // puts it, and its import of @huggingface/transformers, in a chunk loaded only when used.
  splitting: true,
  sourcemap: false,
  dts: false,
  shims: false,
  noExternal: [/^@pointcast\//],
  external: ["@huggingface/transformers", "@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod"],
  // No `banner` here: src/index.ts already starts with its own "#!/usr/bin/env node", which
  // esbuild moves to the top of the bundle on its own — adding another would duplicate it.
});
