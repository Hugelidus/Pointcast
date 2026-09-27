import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../errors";
import { runProcess } from "./run";

/**
 * `fixtures/sessions/e2e-es`'s `words.json` was produced by a real run of the local engine
 * (`Xenova/whisper-base`) against its committed `audio.wav` (see this package's README-less
 * history in the task report; regenerate with
 * `pnpm --filter pointcast start -- transcribe fixtures/sessions/e2e-es --language es`).
 * Because it is already there, `runProcess` below never has to construct a transcription
 * engine — `--force` is what's needed to exercise that path, and that is the slow test
 * (run.slow.test.ts), which really loads a model and is skipped unless POINTCAST_SLOW=1.
 */
const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/sessions/e2e-es");

describe("runProcess against fixtures/sessions/e2e-es (no model loaded)", () => {
  let sessionDir: string;

  beforeEach(() => {
    // Copy into a scratch directory: runProcess writes words.json (when it transcribes) and
    // session.md next to the session, and the committed fixture must never be mutated by a test.
    sessionDir = mkdtempSync(join(tmpdir(), "pointcast-cli-process-"));
    cpSync(FIXTURE_DIR, sessionDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("skips transcription when words.json is already present", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: false });

    expect(result.transcribed).toBe(false);
    expect(result.words.engine).toBe("local:Xenova/whisper-base");
  });

  // The fusion tests below read the classic format: its inline markers and appendix lines show
  // every placement decision. The default format is "requests".
  it("renders the requests format by default", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: true });

    expect(result.markdown.startsWith("# UI change requests\n")).toBe(true);
  });

  it("anchors both 'esto' markers to the right events", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: false, format: "classic" });

    // First "Esto" (word 0) carries e1 (the "Quantity" header selection).
    expect(result.markdown).toMatch(/Esto \*\[00:01 · th «Quantity» · e1\]\*/);
    // Second "esto" (word 10) carries the index.html burst that follows it (Export, Delete
    // twice, Customers twice), led by Export (e2), the element the speaker means. Delete and
    // Customers were each pointed at twice, so they collapse to "e3 ×2" / "e5 ×2" instead of
    // listing both ids; the burst spans e2 (~7.5 s) to e6 (~9 s, over 1 s later), so the clock
    // is a range.
    const secondEstoMarker = result.markdown.match(/además esto \*(\[[^\n]*\])\*/);
    expect(secondEstoMarker).not.toBeNull();
    const marker = secondEstoMarker![1];
    expect(marker).toBe(
      "[00:07–00:09 · button «Export» · Toolbar.tsx:8 · e2; button «Delete» · e3 ×2; a «Customers» · e5 ×2]",
    );
  });

  it("does not let the plain Delete click (e3) take the second 'esto' from a pointing gesture", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: false, format: "classic" });

    // D7 (2026-09-26): a plain click pays 500 ms extra, so e3 (inside the word, 0 ms) no longer
    // beats the points. The match is e4, the Alt+click on Delete at 8455 ms, which is also
    // inside Whisper's "esto," (7900-8580 ms; the end absorbs the comma), while e2 (Export,
    // 7539 ms, right on the spoken onset) is 361 ms before Whisper's start. Getting e2 needs a
    // different distance (D4.3), not a gesture rule; see the D4 note in docs/decisions.md.
    expect(result.markdown).toContain("- e2: point at 00:07, burst with e4\n");
    expect(result.markdown).toContain("- e3: click at 00:08, burst with e4\n");
    expect(result.markdown).toContain("- e4: point at 00:08, deictic «esto»\n");
  });

  it("never merges the other pages' events into the index.html marker: each page has its own", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: false, format: "classic" });

    // e7..e10 happen on three other pages while the speaker says "que es porte", after the pause
    // that follows "esto," (D4 note 2026-09-27). Each page gets a URL separator before its own
    // marker, in time order; two pages on the same word ("porte") give the later one a line.
    const transcript = result.markdown.split("## Transcript\n\n")[1].split("\n\n## Appendix")[0];
    expect(transcript.split("\n\n").slice(2)).toEqual([
      "— /other.html —",
      "es *[00:09 · button «View orders» · Customers.tsx:21 · e7; a «SPA demo» · e8]*",
      "— /spa.html —",
      "porte *[00:09 · button «Reports» · e9]*",
      "— /spa.html?view=/reports —",
      "*[00:09 · th «Status» · App.tsx:40 · e10]*",
      "solo lo filtrado.",
    ]);
    expect(transcript.split("\n\n")[1]).toMatch(/esto \*\[00:07–00:09 · [^\]]+\]\*, que$/);
  });

  it("lists Export with its source in the appendix", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: false, format: "classic" });

    expect(result.markdown).toMatch(/### e2 · button «Export»/);
    expect(result.markdown).toContain("source: `src/components/Toolbar.tsx:8` (ancestor +1)");
  });

  it("reports the fusion breakdown and the output size", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: false });

    // e1..e6 via the two deictics; e7..e10 (other pages, no burst to join) by time.
    expect(result.summary).toEqual({ total: 10, deictic: 6, time: 4, standalone: 0 });
    expect(result.summaryLine).toBe("10 events (6 deictic, 4 time, 0 standalone)");
    expect(result.chars).toBe(result.markdown.length);
    expect(result.chars).toBeGreaterThan(0);
    expect(result.tokens).toBe(Math.ceil(result.chars / 4));
  });

  it("writes session.md next to the session by default", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: false });

    expect(result.sessionMdPath).toBe(join(sessionDir, "session.md"));
    expect(existsSync(result.sessionMdPath!)).toBe(true);
    expect(readFileSync(result.sessionMdPath!, "utf8")).toBe(result.markdown);
  });

  it("does not write session.md when toStdout is set", async () => {
    const result = await runProcess({ sessionDir, engine: "local", force: false, toStdout: true });

    expect(result.sessionMdPath).toBeUndefined();
    expect(existsSync(join(sessionDir, "session.md"))).toBe(false);
  });
});

/**
 * `fixtures/sessions/e2e-es-v2` is e2e-es as the extension saves it since format v2
 * (session-format.md): schemaVersion 2, words.json from in-browser transcription, no audio.
 * Hand-made from e2e-es (same events and words), so it must render the very same Markdown.
 */
const V2_FIXTURE_DIR = resolve(FIXTURE_DIR, "../e2e-es-v2");

describe("runProcess against fixtures/sessions/e2e-es-v2 (format v2, no audio)", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "pointcast-cli-process-v2-"));
    cpSync(V2_FIXTURE_DIR, sessionDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("renders from words.json without needing audio, exactly like the v1 session", async () => {
    const v2 = await runProcess({ sessionDir, engine: "local", force: false, toStdout: true });
    const v1 = await runProcess({ sessionDir: FIXTURE_DIR, engine: "local", force: false, toStdout: true });

    expect(v2.transcribed).toBe(false);
    expect(v2.session.schemaVersion).toBe(2);
    expect(v2.session.audio).toBeUndefined();
    expect(v2.markdown).toBe(v1.markdown);
  });

  it("gives a friendly error when there is neither words.json nor audio", async () => {
    rmSync(join(sessionDir, "words.json"));
    const run = runProcess({ sessionDir, engine: "local", force: false, toStdout: false });

    await expect(run).rejects.toThrow(CliError);
    await expect(run).rejects.toThrow(/no words\.json and was saved without audio/);
    expect(existsSync(join(sessionDir, "session.md"))).toBe(false);
  });

  it("explains that --force needs the audio this session does not have", async () => {
    const run = runProcess({ sessionDir, engine: "local", force: true, toStdout: false });

    await expect(run).rejects.toThrow(/--force re-transcribes the audio/);
    // The words.json it came with is left alone.
    expect(existsSync(join(sessionDir, "words.json"))).toBe(true);
  });
});
