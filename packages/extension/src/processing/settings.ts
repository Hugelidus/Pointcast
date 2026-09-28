/**
 * The popup's settings, kept in chrome.storage.local so they survive browser restarts.
 * Read by the service worker when a recording stops, never cached in a variable (D6).
 */

export interface Settings {
  /** "auto", or an ISO 639-1 code Whisper knows (WHISPER_LANGUAGES). */
  language: string;
  /** Save audio.wav next to the Markdown. Off by default: the Markdown is what the user wants. */
  keepAudio: boolean;
  /** A system notification when processing ends. */
  notify: boolean;
  /**
   * Send a recording to a running pointcast MCP server instead of downloading it (D11). On by
   * default: it only acts when a server answers, and the files land where its tools read them.
   */
  handoff: boolean;
}

export const DEFAULT_SETTINGS: Settings = { language: "auto", keepAudio: false, notify: true, handoff: true };

/** chrome.storage.local key. */
export const SETTINGS_KEY = "settings";

/** Every language whisper-base can transcribe, from its generation_config.json (lang_to_id). */
export const WHISPER_LANGUAGES = [
  "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca", "cs", "cy", "da", "de", "el", "en",
  "es", "et", "eu", "fa", "fi", "fo", "fr", "gl", "gu", "haw", "ha", "he", "hi", "hr", "ht", "hu", "hy", "id", "is",
  "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn",
  "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru", "sa", "sd", "si", "sk",
  "sl", "sn", "so", "sq", "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz",
  "vi", "yi", "yo", "zh",
] as const;

export function parseSettings(value: unknown): Settings {
  const v = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    language:
      typeof v.language === "string" && (WHISPER_LANGUAGES as readonly string[]).includes(v.language)
        ? v.language
        : DEFAULT_SETTINGS.language,
    keepAudio: typeof v.keepAudio === "boolean" ? v.keepAudio : DEFAULT_SETTINGS.keepAudio,
    notify: typeof v.notify === "boolean" ? v.notify : DEFAULT_SETTINGS.notify,
    handoff: typeof v.handoff === "boolean" ? v.handoff : DEFAULT_SETTINGS.handoff,
  };
}

/** The language to transcribe in, or undefined to detect it. */
export function chosenLanguage(settings: Settings): string | undefined {
  return settings.language === "auto" ? undefined : settings.language;
}

/** "Spanish" for "es", in English like the rest of the UI; the code itself when unknown. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
