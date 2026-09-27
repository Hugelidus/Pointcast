import type { LocalTranscriptionEngine, TranscribeOptions, TranscriptionEngine } from "@pointcast/transcribe";
import type { WordsFile } from "@pointcast/core";
import { CliError } from "../errors";
import { OpenAiTranscriptionEngine, type OpenAiEngineOptions } from "./openai";

export type { TranscribeOptions, TranscriptionEngine } from "@pointcast/transcribe";
export { OpenAiTranscriptionEngine, type OpenAiEngineOptions } from "./openai";

export type EngineName = "local" | "openai";

/** Options accepted by the CLI's `--engine`/`--model`/`--threads` flags (packages/cli/src/index.ts). */
export interface CreateEngineOptions {
  model?: string;
  threads?: number;
}

/** Picks and constructs an engine by the name the CLI's `--engine` flag accepts. */
export function createEngine(engineName: EngineName, options: CreateEngineOptions = {}): TranscriptionEngine {
  switch (engineName) {
    case "local":
      return new CliLocalEngine(options);
    case "openai": {
      const openaiOpts: OpenAiEngineOptions = { model: options.model };
      return new OpenAiTranscriptionEngine(openaiOpts);
    }
    default: {
      const exhaustive: never = engineName;
      throw new Error(`Unknown transcription engine: ${exhaustive as string}`);
    }
  }
}

/**
 * @pointcast/transcribe's DEFAULT_MODEL, repeated rather than imported: importing anything from
 * that package would load transformers.js at startup (transcribe/index.test.ts checks they agree).
 */
export const LOCAL_DEFAULT_MODEL = "Xenova/whisper-base";

/**
 * The local engine is the only part of the CLI that needs transformers.js and ONNX Runtime
 * (about 450 MB installed), so they are an optional peer dependency, loaded on first use:
 * `npx pointcast mcp` and `pointcast process` on a session the extension already transcribed
 * install and start without them. tsup's code splitting keeps this import out of the main bundle.
 */
async function loadLocalEngine(): Promise<typeof import("@pointcast/transcribe")> {
  try {
    return await import("@pointcast/transcribe");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && String(error).includes("@huggingface/transformers");
    if (!missing) throw error;
    throw new CliError(
      "Transcribing on this machine needs @huggingface/transformers, which is not installed with pointcast to keep it small. " +
        'Install it next to pointcast ("npm install -g @huggingface/transformers" when pointcast is installed globally), ' +
        'run "npx -p pointcast -p @huggingface/transformers pointcast ...", or use --engine openai.',
    );
  }
}

/**
 * The shared local engine speaks to any interface; this adds what only the CLI says: which flag
 * fixes a language problem, and the note about the unsupported prompt.
 */
class CliLocalEngine implements TranscriptionEngine {
  readonly name: string;
  private engine: LocalTranscriptionEngine | undefined;

  constructor(private readonly options: CreateEngineOptions) {
    this.name = `local:${options.model ?? LOCAL_DEFAULT_MODEL}`;
  }

  async transcribe(samples: Float32Array, opts: TranscribeOptions): Promise<WordsFile> {
    if (opts.prompt) warnPromptUnsupportedOnce();
    const { LocalTranscriptionEngine, TranscriptionError } = await loadLocalEngine();
    this.engine ??= new LocalTranscriptionEngine({ model: this.options.model, threads: this.options.threads });
    try {
      return await this.engine.transcribe(samples, opts);
    } catch (error) {
      if (!(error instanceof TranscriptionError)) throw error;
      throw new CliError(
        error.code === "language-uncertain"
          ? `${error.message} Pass it with --language (e.g. --language es) or set POINTCAST_LANGUAGE. Nothing was written.`
          : `${error.message} Pass it with --language.`,
      );
    }
  }
}

// Warn at most once per process: transcribing a whole session directory can call
// transcribe() many times, and the cause (a library limitation, not a user mistake) does
// not change between calls.
let warnedPromptUnsupported = false;
function warnPromptUnsupportedOnce(): void {
  if (warnedPromptUnsupported) return;
  warnedPromptUnsupported = true;
  // Printed because docs/decisions.md D1 promises this prompt: the user should know when it is
  // not applied (see LocalTranscriptionEngine's doc comment for why it is not).
  console.warn(
    "[pointcast] note: the local engine cannot use the captured element texts as Whisper's initial prompt " +
      "(not supported by @huggingface/transformers yet), so rare UI labels may be misspelled. " +
      "--engine openai uses them.",
  );
}
