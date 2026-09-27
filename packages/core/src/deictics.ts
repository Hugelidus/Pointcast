/**
 * Deictic words ("this", "here", "esto", "aquí"...) are the words that need a pointing
 * gesture to make sense. Fusion anchors events to them first (decision D4).
 */

/**
 * Lowercase, strip accents and punctuation, trim.
 * Whisper tokens arrive as " Esto," or "Aquí." — comparing them against a list only works
 * after removing everything that is not a letter or a digit. Accents are stripped too
 * because transcription engines are inconsistent about them ("aqui" vs "aquí").
 */
export function normalizeWord(text: string): string {
  return (
    text
      .toLowerCase()
      // NFD splits "í" into "i" + a combining accent mark (\p{M}), which we then drop.
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, "")
  );
}

/** Spanish deictics, already normalized (no accents). */
export const DEICTICS_ES: readonly string[] = [
  "esto",
  "eso",
  "este",
  "esta",
  "estos",
  "estas",
  "ese",
  "esa",
  "esos",
  "esas",
  "aquel",
  "aquella",
  "aquello",
  "aquellos",
  "aquellas",
  "aqui",
  "ahi",
  "alli",
  "aca",
];

/** English deictics, already normalized. */
export const DEICTICS_EN: readonly string[] = ["this", "that", "these", "those", "here", "there"];

/**
 * French, German, Portuguese and Italian deictics, already normalized.
 * Left out on purpose: forms that only differ from an ordinary word by an accent, which
 * normalization strips — French/Italian "là" and Italian "lì" would become the articles "la"
 * and "li", among the most frequent words of those languages.
 */
export const DEICTICS_FR: readonly string[] = [
  "ceci",
  "cela",
  "ca",
  "ce",
  "cet",
  "cette",
  "ces",
  "celui",
  "celle",
  "ceux",
  "celles",
  "celuici",
  "celleci",
  "ici",
];

export const DEICTICS_DE: readonly string[] = [
  "das",
  "dies",
  "diese",
  "dieser",
  "dieses",
  "diesen",
  "diesem",
  "hier",
  "da",
  "dort",
];

export const DEICTICS_PT: readonly string[] = [
  "isto",
  "isso",
  "aquilo",
  "este",
  "esta",
  "estes",
  "estas",
  "esse",
  "essa",
  "esses",
  "essas",
  "aquele",
  "aquela",
  "aqueles",
  "aquelas",
  "aqui",
  "ai",
  "ali",
  "ca",
];

export const DEICTICS_IT: readonly string[] = [
  "questo",
  "questa",
  "questi",
  "queste",
  "quello",
  "quella",
  "quelli",
  "quelle",
  "qui",
  "qua",
];

/**
 * Default list: both languages at once. The lists do not collide with ordinary words of
 * the other language, so the union works without knowing the transcript language, and a
 * bilingual speaker ("this botón") is still covered.
 */
export const DEFAULT_DEICTICS: readonly string[] = [...DEICTICS_ES, ...DEICTICS_EN];

const BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  fr: DEICTICS_FR,
  de: DEICTICS_DE,
  pt: DEICTICS_PT,
  it: DEICTICS_IT,
};

/**
 * Deictics for a transcript language (ISO 639-1, e.g. "fr" or "pt-BR"): that language plus
 * English, since UI talk borrows English words. Spanish, English and unknown languages get
 * DEFAULT_DEICTICS. Why per language and not one big union: German "da" and "das" are
 * ordinary Spanish and Italian words ("da igual", "da Roma"), so they only count when the
 * transcript is German.
 */
export function deicticsForLanguage(language: string | undefined): readonly string[] {
  const extra = BY_LANGUAGE[(language ?? "").toLowerCase().split(/[-_]/)[0]];
  return extra ? [...extra, ...DEICTICS_EN] : DEFAULT_DEICTICS;
}

/** Build a lookup set from a list, normalizing entries so users may write "aquí" in config. */
export function deicticSet(list: readonly string[] = DEFAULT_DEICTICS): ReadonlySet<string> {
  return new Set(list.map(normalizeWord).filter((word) => word !== ""));
}

const DEFAULT_SET = deicticSet(DEFAULT_DEICTICS);

/**
 * Words that only look like deictics once accents are stripped. "está" (the verb "is") is
 * one of the most frequent Spanish words and becomes "esta" ("this") after normalization.
 * The accent is the only difference, and engines do write it for this verb, so we check
 * these forms before stripping accents. Compared lowercase, punctuation removed, accents kept.
 */
const ACCENTED_NON_DEICTICS: ReadonlySet<string> = new Set(["está"]);

/** True when the word (raw engine text) is a deictic according to the given list or set. */
export function isDeictic(
  word: string,
  list: readonly string[] | ReadonlySet<string> = DEFAULT_SET,
): boolean {
  const set = list instanceof Set ? list : deicticSet(list as readonly string[]);
  // NFC so that "está" typed as "a" + combining accent compares equal to the precomposed form.
  const accented = word.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "");
  if (ACCENTED_NON_DEICTICS.has(accented)) return false;
  const normalized = normalizeWord(word);
  return normalized !== "" && set.has(normalized);
}
