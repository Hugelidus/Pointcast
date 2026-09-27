import type { SessionFile } from "@pointcast/core";

/**
 * Whisper's (and OpenAI-compatible APIs') initial-prompt conditioning is meant to bias
 * vocabulary, not carry the transcript — a few dozen words is the documented sweet spot, and
 * OpenAI's own docs note only its last ~224 tokens are actually used. Well under that, in
 * characters rather than tokens since this never gets tokenized here.
 */
const PROMPT_CHAR_BUDGET = 300;

/**
 * Builds a short initial-transcription prompt from the elements the user pointed at: their
 * visible text (falling back to the label for icon-only elements), deduplicated and in
 * first-appearance order. These are exactly the proper nouns and product terms a generic
 * speech model is most likely to mis-hear ("Toolbar" as "toolbar", a product name, …), so
 * feeding them back as a hint (D1/D9) is worth it whenever the engine honors it — the local
 * engine currently does not (LocalTranscriptionEngine warns and ignores it) and the
 * OpenAI-compatible one does; this function does not need to know which, since unsupported
 * prompts are simply ignored downstream.
 * Returns undefined when there is nothing usable (no events, or every element is blank/redacted).
 */
export function buildInitialPrompt(session: SessionFile): string | undefined {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const event of session.events) {
    const term = (event.element.text || event.element.label || "").trim();
    if (term === "" || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  if (terms.length === 0) return undefined;

  let prompt = terms[0];
  for (const term of terms.slice(1)) {
    const next = `${prompt}, ${term}`;
    if (next.length > PROMPT_CHAR_BUDGET) break;
    prompt = next;
  }
  return prompt;
}
