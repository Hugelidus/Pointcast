import type { TranscriptionProgress } from "@pointcast/transcribe";
import type { EngineConfig, TranscribeDone, TranscribeJob, WorkerJob, WorkerMessage } from "./protocol";

/**
 * Whisper gets half the logical cores, at most 8: in the spike 8 threads were only 12 % faster
 * than 4 (38 s vs 43 s for 152 s of audio), and the user keeps working while it runs.
 */
export function transcriptionThreads(hardwareConcurrency: number): number {
  return Math.min(8, Math.max(1, Math.floor(hardwareConcurrency / 2)));
}

/**
 * Live transcription runs while the user works: 4 threads at most
 * (D1 note 2026-09-27, live transcription).
 */
export function liveTranscriptionThreads(hardwareConcurrency: number): number {
  return Math.min(4, transcriptionThreads(hardwareConcurrency));
}

/**
 * One module worker with the engine in it, for one recording. Jobs are answered in order
 * (worker.ts), so each answer settles the oldest waiting job. Call terminate() when done, whatever
 * happens: ONNX Runtime keeps its WASM memory (about 1 GB with whisper-base) until the worker
 * goes away, so a worker kept between sessions would hold it all day.
 */
export class TranscriptionWorker {
  /** Where progress reports go; changed when the job the user waits for starts. */
  onProgress: ((progress: TranscriptionProgress) => void) | undefined;
  readonly #worker: Worker;
  readonly #waiting: { resolve: (message: WorkerMessage) => void; reject: (error: Error) => void }[] = [];
  #failed: Error | undefined;

  constructor(private readonly config: EngineConfig) {
    // Vite bundles the worker from this URL (with transformers.js inside) as a module worker.
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.#worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === "progress") {
        this.onProgress?.(data.progress);
        return;
      }
      const job = this.#waiting.shift();
      if (data.type === "error") job?.reject(new Error(data.message));
      else job?.resolve(data);
    };
    // A script that fails to load or an uncaught error; the message is often empty then.
    this.#worker.onerror = (event) => {
      this.#failed = new Error(event.message || "The transcription worker failed to start.");
      for (const job of this.#waiting.splice(0)) job.reject(this.#failed);
    };
  }

  /** Loads the model; resolves with the load time in ms. */
  async preload(): Promise<number> {
    const answer = await this.#send({ type: "preload", ...this.config });
    return answer.type === "ready" ? answer.loadMs : 0;
  }

  async transcribe(job: Omit<TranscribeJob, "type" | keyof EngineConfig>): Promise<TranscribeDone> {
    const answer = await this.#send({ type: "transcribe", ...this.config, ...job });
    if (answer.type !== "done") throw new Error("The transcription worker answered out of order.");
    return answer;
  }

  terminate(): void {
    this.#worker.terminate();
    const error = new Error("Transcription was stopped.");
    for (const job of this.#waiting.splice(0)) job.reject(error);
  }

  #send(job: WorkerJob): Promise<WorkerMessage> {
    if (this.#failed) return Promise.reject(this.#failed);
    return new Promise((resolve, reject) => {
      this.#waiting.push({ resolve, reject });
      this.#worker.postMessage(job);
    });
  }
}

/**
 * Rejects once `deadline` (epoch ms) passes. Enforced here, in the offscreen document, and not
 * in the worker: a worker busy in WASM cannot run its own timers, but it can always be
 * terminated from outside, which the caller does.
 */
export function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Transcription took too long and was stopped.")), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export interface WorkerJobOptions {
  /** Epoch ms after which the job is abandoned and the worker terminated. */
  deadline: number;
  onProgress: (progress: TranscriptionProgress) => void;
}

/** One transcription of the whole recording in a fresh worker, terminated afterwards. */
export function transcribeInWorker(job: Omit<TranscribeJob, "type">, options: WorkerJobOptions): Promise<TranscribeDone> {
  const { samples, language, fallbackLanguage, ...config } = job;
  const worker = new TranscriptionWorker(config);
  worker.onProgress = options.onProgress;
  const work = worker.transcribe({ samples, ...(language ? { language } : {}), ...(fallbackLanguage ? { fallbackLanguage } : {}) });
  return beforeDeadline(work, options.deadline).finally(() => worker.terminate());
}
