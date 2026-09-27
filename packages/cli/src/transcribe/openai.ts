import type { Word, WordsFile } from "@pointcast/core";
import { encodeWavPcm16Mono16k } from "../audio/wav";
import { CliError } from "../errors";
import type { TranscribeOptions, TranscriptionEngine } from "@pointcast/transcribe";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "whisper-1";

export interface OpenAiEngineOptions {
  /** Defaults to POINTCAST_API_BASE, then "https://api.openai.com/v1" — any OpenAI-compatible
   * server (Groq, a local one) works as long as it implements POST {baseUrl}/audio/transcriptions. */
  baseUrl?: string;
  /** Defaults to POINTCAST_API_KEY, then OPENAI_API_KEY but only for api.openai.com (see
   * resolveApiKey). Some self-hosted servers accept requests without one. */
  apiKey?: string;
  model?: string;
  /** Injected for tests (D1's "no network in tests" requirement) — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests so they never read or mutate the real environment; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

const OPENAI_HOST = "api.openai.com";

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * The request carries the user's voice and a secret key, so it must not travel in clear text.
 * Plain http is only accepted on the user's own machine (a local whisper server).
 */
function parseEndpoint(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CliError(`POINTCAST_API_BASE is not a valid URL: "${baseUrl}".`);
  }
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return url;
  throw new CliError(
    `Refusing to send audio to ${baseUrl}: use https, or plain http only for a server on this machine (localhost).`,
  );
}

/**
 * OPENAI_API_KEY is often exported globally for other tools. Sending it to whatever server
 * POINTCAST_API_BASE names (Groq, a LAN box) would hand an OpenAI secret to a third party, so
 * it is only used for OpenAI's own host; other servers get POINTCAST_API_KEY or nothing.
 */
function resolveApiKey(endpoint: URL, explicit: string | undefined, env: Record<string, string | undefined>): string | undefined {
  if (explicit !== undefined) return explicit;
  if (env.POINTCAST_API_KEY) return env.POINTCAST_API_KEY;
  return endpoint.hostname === OPENAI_HOST ? env.OPENAI_API_KEY : undefined;
}

/** One entry of the "word" timestamp_granularities response. */
interface OpenAiVerboseWord {
  word: string;
  start: number;
  end: number;
}

/** The subset of the verbose_json transcription response this engine reads. */
interface OpenAiVerboseTranscription {
  text: string;
  language?: string;
  words?: OpenAiVerboseWord[];
}

/**
 * D1: "an alternative engine targets any OpenAI-compatible transcription endpoint […] for
 * users who prefer speed or quality over locality". Same WordsFile output as the local
 * engine, so fusion never needs to know which one produced it.
 */
export class OpenAiTranscriptionEngine implements TranscriptionEngine {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly model: string;

  constructor(options: OpenAiEngineOptions = {}) {
    const env = options.env ?? process.env;
    this.baseUrl = (options.baseUrl ?? env.POINTCAST_API_BASE ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = resolveApiKey(parseEndpoint(this.baseUrl), options.apiKey, env);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.model = options.model ?? DEFAULT_MODEL;
    this.name = `openai:${this.model}`;
  }

  async transcribe(samples: Float32Array, opts: TranscribeOptions): Promise<WordsFile> {
    const wavBytes = encodeWavPcm16Mono16k(samples);
    // A plain Uint8Array is not itself a valid Blob part in all environments handled by our
    // TS lib target; wrap in a fresh buffer view backed by exactly these bytes.
    const file = new Blob([wavBytes], { type: "audio/wav" });

    const form = new FormData();
    form.set("file", file, "audio.wav");
    form.set("model", this.model);
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    if (opts.language) form.set("language", opts.language);
    if (opts.prompt) form.set("prompt", opts.prompt);

    const headers: Record<string, string> = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers,
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `OpenAI-compatible transcription request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
      );
    }

    const json = (await response.json()) as OpenAiVerboseTranscription;
    const words: Word[] = (json.words ?? []).map((w) => ({
      text: w.word,
      start: secondsToMs(w.start),
      end: secondsToMs(w.end),
    }));

    return {
      schemaVersion: 1,
      engine: this.name,
      language: json.language ?? opts.language,
      words,
    };
  }
}

function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}
