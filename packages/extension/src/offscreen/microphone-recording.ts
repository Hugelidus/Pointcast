/** getUserMedia failed because the extension origin has no microphone grant. */
export class MicrophoneDeniedError extends Error {
  constructor() {
    super("Pointcast needs the microphone. Allow it in the tab that just opened, then press Record again.");
    this.name = "MicrophoneDeniedError";
  }
}

const PREFERRED_MIME_TYPE = "audio/webm;codecs=opus";
/** Chunk every second so a long session is not one giant buffer at the end. */
const TIMESLICE_MS = 1000;
/**
 * After a recorder "error" event the spec fires "stop" right away; this is only a safety net
 * in case a browser does not, so a Stop press can never wait forever.
 */
const STOP_AFTER_ERROR_MS = 1000;

/** One MediaRecorder session on the default microphone. */
export class MicrophoneRecording {
  /** Date.now() at the recorder's start event: the moment of audio sample 0 (D6). */
  readonly t0: number;
  readonly #recorder: MediaRecorder;
  readonly #chunks: Blob[];
  /** Settles once, when the recorder stops for any reason, with everything recorded. */
  readonly #stopped: Promise<Blob>;
  #stopRequested = false;
  #endedEarlyAt: number | undefined;

  private constructor(recorder: MediaRecorder, stopped: Promise<number>, chunks: Blob[], t0: number) {
    this.#recorder = recorder;
    this.#chunks = chunks;
    this.t0 = t0;
    this.#stopped = stopped.then((endedAt) => {
      // Stopped without a Stop press: the microphone went away (unplugged, OS privacy
      // switch, permission revoked). The audio so far is kept; the popup says when it ended.
      if (!this.#stopRequested) this.#endedEarlyAt = endedAt;
      releaseMicrophone(recorder.stream);
      return new Blob(chunks, { type: recorder.mimeType });
    });
  }

  static async start(): Promise<MicrophoneRecording> {
    const stream = await openMicrophone();
    const mimeType = MediaRecorder.isTypeSupported(PREFERRED_MIME_TYPE) ? PREFERRED_MIME_TYPE : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    // Listen for the end from the very beginning. When every track ends (a USB or Bluetooth
    // microphone is disconnected, the OS microphone switch is turned off), Chrome stops the
    // recorder and fires "stop" at that moment. A listener added only when the user presses
    // Stop would miss it, and recorder.stop() on an inactive recorder does nothing: no event,
    // no error. The Stop press would then wait forever and the session would be lost.
    const stopped = new Promise<number>((resolve) => {
      recorder.addEventListener("stop", () => resolve(Date.now()), { once: true });
      recorder.addEventListener("error", () => setTimeout(() => resolve(Date.now()), STOP_AFTER_ERROR_MS), {
        once: true,
      });
    });

    // t0 comes from the start event, not from the Record press: getUserMedia and the
    // recorder start take 100-300 ms, and events are aligned to the audio, not to the button.
    const t0 = await new Promise<number>((resolve, reject) => {
      recorder.addEventListener("start", () => resolve(Date.now()), { once: true });
      recorder.addEventListener("error", () => reject(new Error("The audio recorder failed to start")), {
        once: true,
      });
      recorder.start(TIMESLICE_MS);
    }).catch((error: unknown) => {
      releaseMicrophone(stream);
      throw error;
    });
    return new MicrophoneRecording(recorder, stopped, chunks, t0);
  }

  /** Date.now() when the recorder stopped by itself, before any Stop press; undefined otherwise. */
  get endedEarlyAt(): number | undefined {
    return this.#endedEarlyAt;
  }

  /**
   * Everything recorded up to the last 1 s chunk, as a WebM stream that decodes like the whole
   * recording does (its first chunk carries the header), for live transcription.
   */
  recordedSoFar(): Blob {
    return new Blob(this.#chunks, { type: this.#recorder.mimeType });
  }

  /** Stops recording (if it has not stopped already), releases the microphone and returns the recording. */
  stop(): Promise<Blob> {
    this.#stopRequested = true;
    // The final dataavailable event fires before stop, so all chunks are in once #stopped settles.
    if (this.#recorder.state !== "inactive") this.#recorder.stop();
    return this.#stopped;
  }
}

async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    // An offscreen document cannot show a permission prompt: without a prior grant
    // (given in the permission page) getUserMedia fails with NotAllowedError.
    if (error instanceof DOMException && error.name === "NotAllowedError") throw new MicrophoneDeniedError();
    if (error instanceof DOMException && error.name === "NotFoundError") throw new Error("No microphone was found.");
    throw error;
  }
}

/** Stopping the tracks turns off the browser's "microphone in use" indicator. */
function releaseMicrophone(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
