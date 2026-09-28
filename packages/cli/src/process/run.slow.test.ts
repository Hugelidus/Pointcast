import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { constants, setPriority, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CliError } from "../errors";
import { runProcess } from "./run";

/**
 * Real transcription: loads Xenova/whisper-base (downloaded once, then cached) and runs it on
 * the fixture's audio.wav, the same way the fast test's committed words.json was produced.
 * Guarded so `pnpm test` stays fast and offline. Run with:
 *   POINTCAST_SLOW=1 pnpm vitest run packages/cli/src/process/run.slow.test.ts
 */
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../dev/fixtures");
const SESSION_FIXTURE = join(FIXTURES, "sessions/e2e-es");

/** A scratch copy of the fixture session, optionally with another recording as its audio. */
function scratchSession(audio?: string): string {
  const sessionDir = mkdtempSync(join(tmpdir(), "pointcast-cli-process-slow-"));
  cpSync(SESSION_FIXTURE, sessionDir, { recursive: true });
  if (audio) cpSync(audio, join(sessionDir, "audio.wav"));
  return sessionDir;
}

describe.skipIf(process.env.POINTCAST_SLOW !== "1")("runProcess --force (real local transcription)", () => {
  beforeAll(() => {
    // Keep the machine responsive while the model runs (the ONNX threads inherit this).
    setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  });

  // Do-not-disturb: at most 4 ONNX threads, whatever the core count.
  // Classic format: its inline markers show where each event was anchored in the transcript (the
  // default "requests" format has no times, so these checks predate it).
  const base = { engine: "local", force: true, threads: 4, toStdout: false, format: "classic" } as const;

  it("transcribes with a forced language and anchors both 'esto' markers", { timeout: 120_000 }, async () => {
    const sessionDir = scratchSession();
    try {
      const result = await runProcess({ ...base, sessionDir, language: "es" });
      expect(result.transcribed).toBe(true);
      expect(result.words.language).toBe("es");
      expect(result.markdown).toMatch(/Esto \*\[00:01 · th «Quantity» · e1\]\*/);
      expect(result.markdown).toMatch(/### e2 · button «Export»/);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("detects Spanish when no language is given, despite the leading silence", { timeout: 120_000 }, async () => {
    // Before the fix transformers.js silently used English here and produced an invented
    // English sentence ("This would be a lot of work…"), which was then cached.
    const sessionDir = scratchSession();
    try {
      const result = await runProcess({ ...base, sessionDir });
      expect(result.words.language).toBe("es");
      expect(result.markdown).toMatch(/Esto \*\[00:01 · th «Quantity» · e1\]\*/);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("asks for --language when unsure, and caches nothing", { timeout: 120_000 }, async () => {
    // en-short is a synthetic voice the model cannot place (Latin vs Arabic, ~50% each).
    const sessionDir = scratchSession(join(FIXTURES, "audio/en-short.wav"));
    rmSync(join(sessionDir, "words.json"));
    try {
      const run = runProcess({ ...base, sessionDir });
      await expect(run).rejects.toThrow(CliError);
      await expect(run).rejects.toThrow(/--language/);
      expect(existsSync(join(sessionDir, "words.json"))).toBe(false);
      expect(existsSync(join(sessionDir, "session.md"))).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
