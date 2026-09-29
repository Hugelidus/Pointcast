/**
 * The popup's settings, kept in chrome.storage.local so they survive browser restarts.
 * Read by the service worker when a recording stops, never cached in a variable (D6).
 */
import type { InputMode } from "@pointcast/core";
import { TRANSCRIPTION_QUALITIES, type TranscriptionQuality } from "./speech-model";

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
  /**
   * Speak, or type a note for each gesture (D12). Read by the service worker at Record, so a
   * recording keeps the mode it started with. Voice by default: settings saved before 0.4.0 have
   * no such field.
   */
  inputMode: InputMode;
  /**
   * Debug capture (D13): while recording, keep the page's uncaught errors, console errors and
   * warnings and failed requests, and list those around each gesture in the spec. On by default,
   * on local dev hosts and (redacted) on enabled sites; read at Record, like inputMode.
   */
  captureErrors: boolean;
  /**
   * Which Whisper model transcribes (speech-model.ts): "fast" (whisper-base) or "accurate"
   * (whisper-small, slower, a download of its own on first use). Read at Record for live
   * transcription and again at Stop; a change in between makes Stop transcribe everything again
   * with the new choice, like a language change. Fast by default (D1 note 2026-09-29).
   */
  quality: TranscriptionQuality;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "auto",
  keepAudio: false,
  notify: true,
  handoff: true,
  inputMode: "voice",
  captureErrors: true,
  quality: "fast",
};

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
    inputMode: v.inputMode === "typed" || v.inputMode === "voice" ? v.inputMode : DEFAULT_SETTINGS.inputMode,
    captureErrors: typeof v.captureErrors === "boolean" ? v.captureErrors : DEFAULT_SETTINGS.captureErrors,
    quality: (TRANSCRIPTION_QUALITIES as readonly unknown[]).includes(v.quality)
      ? (v.quality as TranscriptionQuality)
      : DEFAULT_SETTINGS.quality,
  };
}

/** The language to transcribe in, or undefined to detect it. */
export function chosenLanguage(settings: Settings): string | undefined {
  return settings.language === "auto" ? undefined : settings.language;
}

/**
 * Whisper's own English names (its tokenizer's LANGUAGES), for the codes Chrome's trimmed ICU data
 * cannot name: the popup listed "ba" and "bo" as bare codes. "jw" is Whisper's code for Javanese,
 * which ISO 639-1 spells "jv".
 */
const WHISPER_NAMES: Readonly<Record<string, string>> = {
  af: "Afrikaans", am: "Amharic", ar: "Arabic", as: "Assamese", az: "Azerbaijani", ba: "Bashkir", be: "Belarusian",
  bg: "Bulgarian", bn: "Bengali", bo: "Tibetan", br: "Breton", bs: "Bosnian", ca: "Catalan", cs: "Czech", cy: "Welsh",
  da: "Danish", de: "German", el: "Greek", en: "English", es: "Spanish", et: "Estonian", eu: "Basque", fa: "Persian",
  fi: "Finnish", fo: "Faroese", fr: "French", gl: "Galician", gu: "Gujarati", haw: "Hawaiian", ha: "Hausa",
  he: "Hebrew", hi: "Hindi", hr: "Croatian", ht: "Haitian Creole", hu: "Hungarian", hy: "Armenian", id: "Indonesian",
  is: "Icelandic", it: "Italian", ja: "Japanese", jw: "Javanese", ka: "Georgian", kk: "Kazakh", km: "Khmer",
  kn: "Kannada", ko: "Korean", la: "Latin", lb: "Luxembourgish", ln: "Lingala", lo: "Lao", lt: "Lithuanian",
  lv: "Latvian", mg: "Malagasy", mi: "Maori", mk: "Macedonian", ml: "Malayalam", mn: "Mongolian", mr: "Marathi",
  ms: "Malay", mt: "Maltese", my: "Burmese", ne: "Nepali", nl: "Dutch", nn: "Norwegian Nynorsk", no: "Norwegian",
  oc: "Occitan", pa: "Punjabi", pl: "Polish", ps: "Pashto", pt: "Portuguese", ro: "Romanian", ru: "Russian",
  sa: "Sanskrit", sd: "Sindhi", si: "Sinhala", sk: "Slovak", sl: "Slovenian", sn: "Shona", so: "Somali",
  sq: "Albanian", sr: "Serbian", su: "Sundanese", sv: "Swedish", sw: "Swahili", ta: "Tamil", te: "Telugu",
  tg: "Tajik", th: "Thai", tk: "Turkmen", tl: "Tagalog", tr: "Turkish", tt: "Tatar", uk: "Ukrainian", ur: "Urdu",
  uz: "Uzbek", vi: "Vietnamese", yi: "Yiddish", yo: "Yoruba", zh: "Chinese",
};

/**
 * "Spanish" for "es", in English like the rest of the UI: the browser's name when it has one,
 * then Whisper's, and the code itself only for a code neither knows.
 */
export function languageName(code: string): string {
  return nameOrFallback(code, browserLanguageName(code));
}

/** `named` is the browser's name for `code`; exported for the test, which cannot trim Node's ICU. */
export function nameOrFallback(code: string, named: string | undefined): string {
  // Without data for a code, Intl.DisplayNames gives the code back rather than undefined.
  if (named && named.toLowerCase() !== code.toLowerCase()) return named;
  return WHISPER_NAMES[code] ?? code;
}

function browserLanguageName(code: string): string | undefined {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code);
  } catch {
    return undefined;
  }
}
