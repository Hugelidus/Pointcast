import { renderAppendix } from "./appendix";
import { deicticsForLanguage } from "./deictics";
import { formatClock } from "./describe";
import { fuse, type FuseOptions } from "./fuse";
import { escapeMarkdown, inlineText } from "./markdown";
import { isTypedSession, TYPED_SESSION_WORDS } from "./notes";
import { renderRequests, renderTypedRequests, type RequestsLayout } from "./requests";
import type { CapturedEvent, SessionFile, WordsFile } from "./schema";
import { renderTranscript } from "./transcript";

/**
 * - requests: numbered change requests, one per sentence, with search hints per element. The
 *   default: in the 2026-09-27 evaluation (docs/eval/results-2026-09-27.md) agents were at least
 *   as accurate with it as with classic, with ~27 % fewer tokens, fewer turns and less time.
 * - classic:  header, transcript with inline markers, appendix per element (the Phase 1 spec);
 *   kept for auditing a recording against its timeline.
 */
export type RenderFormat = "classic" | "requests";

/**
 * The requests format's layout for elements with code information (see RequestsLayout):
 * "code-first" (the default, 2026-09-27) or "dom-first" (the spec Stage 0 evaluated, kept so an
 * evaluation can compare them). Elements without code information render the same in both, and
 * the classic format ignores it.
 */
export type RenderLayout = RequestsLayout;

export interface RenderOptions {
  format: RenderFormat;
  layout: RenderLayout;
  /**
   * Passed to fuse(); missing fields use DEFAULT_FUSE_OPTIONS, except `deictics`, which
   * defaults to the transcript language's list (deicticsForLanguage).
   */
  fuse: Partial<FuseOptions>;
  /** Target length of one element's part of an inline marker (D5: ~80 chars). */
  markerBudget: number;
  /** Maximum length of each element's HTML in the appendix (D5: 300 chars). */
  htmlBudget: number;
  /** Maximum length of each selected text in the appendix. */
  selectionBudget: number;
  /** A gap between words at least this long starts a new transcript paragraph (classic) or sentence (requests). */
  paragraphPauseMs: number;
}

export const DEFAULT_RENDER_OPTIONS: Readonly<RenderOptions> = {
  format: "requests",
  layout: "code-first",
  fuse: {},
  markerBudget: 80,
  htmlBudget: 300,
  selectionBudget: 300,
  paragraphPauseMs: 2000,
};

/**
 * The Markdown spec for a coding agent, in `options.format` (see RenderFormat). Pure and
 * deterministic: the same session, words and options always produce the same string.
 *
 * A typed session (SessionFile.inputMode, D12) renders from its notes, always as requests (it
 * has no transcript to lay a timeline on): `words` is ignored there and may be undefined, since
 * such a session has no words.json. A voice session given no words renders as if nothing was said.
 */
export function renderMarkdown(
  session: SessionFile,
  words: WordsFile | undefined,
  options: Partial<RenderOptions> = {},
): string {
  const opts: RenderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options };
  if (isTypedSession(session)) return `${renderTypedRequests(session.events, opts).join("\n\n")}\n`;
  words ??= TYPED_SESSION_WORDS;
  const fuseOptions = { deictics: deicticsForLanguage(words.language), ...opts.fuse };
  const { placements } = fuse(session.events, words.words, fuseOptions);
  const note = unreliableNote(words);
  if (opts.format === "requests") {
    const blocks = renderRequests(session.events, words.words, placements, opts);
    // After the title and the preamble, before the first request.
    if (note) blocks.splice(2, 0, note);
    return `${blocks.join("\n\n")}\n`;
  }

  const eventsById = new Map<string, CapturedEvent>(session.events.map((e) => [e.id, e]));
  // Placements come in time order; the appendix lists elements in that order too.
  const eventsInTimeOrder = placements.flatMap((p) => eventsById.get(p.eventId) ?? []);

  const blocks = [
    ...header(session, words),
    ...(note ? [note] : []),
    "## Transcript",
    ...renderTranscript(words.words, eventsById, placements, opts),
    "## Appendix",
    ...renderAppendix(eventsInTimeOrder, placements, words.words, opts),
  ];
  return `${blocks.join("\n\n")}\n`;
}

/**
 * Rough token count for the CLI's size report: ~4 characters per token is the usual rule of
 * thumb for English with GPT/Claude-style tokenizers. Good enough to watch the budget, not
 * for billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function header(session: SessionFile, words: WordsFile): string[] {
  const count = session.events.length;
  const language = words.language ? ` (${inlineText(words.language)})` : "";
  return [
    `# pointcast session ${inlineText(session.id)}`,
    [
      formatStartedAt(session.startedAt),
      formatClock(session.durationMs),
      `${count} ${count === 1 ? "event" : "events"}`,
      `transcript: ${inlineText(words.engine)}${language}`,
    ].join(" · "),
    "Pointing gestures appear inline as *[time · element · source · id]*; the Appendix details each element. " +
      'An id like "e2 ×5" means the same element was pointed at 5 times — the Appendix lists every one. ' +
      'The time becomes a range ("00:26–00:29") when a marker\'s events span more than 1 s.',
  ];
}

/**
 * One line saying where the transcript was dropped as unreliable (WordsFile.unreliable), so the
 * agent knows the user may have said something there and can ask, instead of acting on a
 * request that silently lacks part of what was said. Undefined when nothing was dropped.
 */
function unreliableNote(words: WordsFile): string | undefined {
  const times = unreliableTimes(words);
  if (!times) return undefined;
  return `_Note: the transcript around ${times} looked unreliable (the speech-to-text repeated itself or invented words) and was dropped; something said there may be missing._`;
}

/**
 * WordsFile.unreliable as text, "00:15–00:30 and 01:02–01:05", or undefined when there is none.
 * The extension's popup words its warning with it too.
 */
export function unreliableTimes(words: Pick<WordsFile, "unreliable">): string | undefined {
  const spans = words.unreliable ?? [];
  if (spans.length === 0) return undefined;
  const times = spans.map(({ start, end }) => {
    const [from, to] = [formatClock(start), formatClock(end)];
    return from === to ? from : `${from}–${to}`;
  });
  return times.length === 1 ? times[0] : `${times.slice(0, -1).join(", ")} and ${times.at(-1)}`;
}

/** "2026-09-26T16:30:05.123Z" -> "2026-09-26 16:30 UTC". Anything unexpected is shown as is. */
function formatStartedAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
    iso,
  );
  if (!match) return inlineText(iso);
  const zone = match[3] === "Z" ? " UTC" : match[3] ? ` ${match[3]}` : "";
  return escapeMarkdown(`${match[1]} ${match[2]}${zone}`);
}
