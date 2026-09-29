import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  estimateTokens,
  fuse,
  isTypedSession,
  renderMarkdown,
  TYPED_SESSION_WORDS,
  type InstructionStyle,
  type RenderFormat,
  type RenderLayout,
  type SessionFile,
  type WordsFile,
} from "@pointcast/core";
import { readAudioSamples } from "../audio/read-audio";
import { CliError } from "../errors";
import { resolveWithRepo, type LocalResolution } from "../resolve/local";
import { createEngine, type EngineName } from "../transcribe";
import { readSessionFile } from "./session-file";
import { buildInitialPrompt } from "./prompt";
import { formatSpecHeader, specStats, summarizeFusion } from "./summary";
import { readWordsFileIfPresent, writeWordsFile } from "./words-file";

export interface ProcessOptions {
  sessionDir: string;
  engine: EngineName;
  model?: string;
  /** Undefined lets the engine detect it (the local engine asks for it when unsure). */
  language?: string;
  threads?: number;
  /** Re-transcribe even if words.json already exists (session-format.md: it is a cache). */
  force: boolean;
  /** Write the Markdown to stdout instead of `session.md`. */
  toStdout: boolean;
  /** `--format`: passed straight through to renderMarkdown (RenderFormat; default "requests"). */
  format?: RenderFormat;
  /** `--layout`: passed straight through to renderMarkdown (RenderLayout; default "code-first"). */
  layout?: RenderLayout;
  /** `--style`: passed straight through to renderMarkdown, over the session's own instructionStyle. */
  style?: InstructionStyle;
  /**
   * Project folder to resolve the recording's code pointers in before rendering (route 1):
   * `--repo`, explicit, or the user's current directory, a guess. Omitted: no resolution.
   */
  repo?: { root: string; explicit: boolean };
}

export interface ProcessResult {
  session: SessionFile;
  words: WordsFile;
  markdown: string;
  /** True when this run transcribed audio and (over)wrote words.json. */
  transcribed: boolean;
  /** A typed session (D12): rendered from its notes, with nothing to transcribe. */
  typed: boolean;
  /** Set unless `toStdout`, in which case nothing was written to disk. */
  sessionMdPath?: string;
  chars: number;
  tokens: number;
  summary: ReturnType<typeof summarizeFusion>;
  /** "8 requests · 17 elements · ~3,100 tokens" (formatSpecHeader). */
  header: string;
  /** Set when `repo` was given: what resolution did, for the one stderr line index.ts prints. */
  resolution?: LocalResolution;
}

/**
 * Plan step 13: read a session, transcribe it if needed (cached in words.json; v2 sessions from
 * the extension already have it, and may have no audio at all), fuse and
 * render it, and write session.md (or return the Markdown for the caller to print). This is
 * the function both `pointcast process` and its tests call — index.ts only parses argv and
 * prints, so the fast test (dev/fixtures/sessions/e2e-es, committed words.json) can exercise the
 * whole pipeline without ever constructing a transcription engine.
 */
export async function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const sessionDir = path.resolve(options.sessionDir);
  const session = await readSessionFile(sessionDir);

  // A typed session (D12) has no audio and no words.json: its notes are the requests, so there is
  // nothing to transcribe, with or without --force.
  const typed = isTypedSession(session);
  const cached = typed ? TYPED_SESSION_WORDS : options.force ? undefined : await readWordsFileIfPresent(sessionDir);
  const transcribed = cached === undefined;
  const words = cached ?? (await transcribe(sessionDir, session, options));
  if (transcribed) await writeWordsFile(sessionDir, words);

  // Resolved locations are render-time data: session.json stays exactly as it was recorded.
  const resolution = options.repo ? await resolveWithRepo(session, options.repo.root, options.repo) : undefined;
  const markdown = renderMarkdown(resolution?.session ?? session, words, {
    ...(options.format ? { format: options.format } : {}),
    ...(options.layout ? { layout: options.layout } : {}),
    ...(options.style ? { style: options.style } : {}),
  });
  // renderMarkdown runs fuse() internally (with the same defaults) to place events in the
  // transcript; it has no way to hand those placements back out, so this recomputes them —
  // cheap for a session's worth of events, and deterministic, so the counts always match what
  // was actually rendered.
  const { placements } = fuse(session.events, words.words);
  const summary = summarizeFusion(placements);
  const tokens = estimateTokens(markdown);
  const header = formatSpecHeader({ requests: specStats(markdown).requests, elements: session.events.length, tokens });

  // Writing to stdout is the caller's job (index.ts): a test that calls runProcess() directly
  // should not spray Markdown across the test runner's own output.
  let sessionMdPath: string | undefined;
  if (!options.toStdout) {
    sessionMdPath = path.join(sessionDir, "session.md");
    await writeFile(sessionMdPath, markdown, "utf8");
  }

  return {
    session,
    words,
    markdown,
    transcribed,
    typed,
    sessionMdPath,
    chars: markdown.length,
    tokens,
    summary,
    header,
    ...(resolution ? { resolution } : {}),
  };
}

async function transcribe(sessionDir: string, session: SessionFile, options: ProcessOptions): Promise<WordsFile> {
  // v2 sessions from the extension carry words.json and may leave the audio out (schema.ts).
  if (!session.audio) {
    throw new CliError(
      options.force
        ? `--force re-transcribes the audio, but this session was saved without it (${sessionDir}). Run without --force to use its words.json.`
        : `Nothing to transcribe in ${sessionDir}: it has no words.json and was saved without audio. ` +
            "Copy the session's words.json back into the folder, or record it again.",
    );
  }
  // audio.file is a plain file name: validateSessionFile rejects paths (session-file.ts).
  const samples = await readAudioSamples(path.join(sessionDir, session.audio.file));

  const engine = createEngine(options.engine, { model: options.model, threads: options.threads });
  return engine.transcribe(samples, {
    language: options.language,
    // D9/prompt.ts: built from the captured elements' texts. Engines that cannot honor it
    // (the local one, today) ignore it themselves; this call site does not need to know which.
    prompt: buildInitialPrompt(session),
  });
}
