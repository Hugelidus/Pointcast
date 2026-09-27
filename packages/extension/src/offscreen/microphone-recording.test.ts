import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MicrophoneRecording } from "./microphone-recording";

/**
 * A MediaRecorder that behaves like Chrome's in the cases that matter here: start and stop
 * events arrive asynchronously, the last dataavailable comes before stop, and stop() on an
 * inactive recorder does nothing at all (no event, no error).
 */
class FakeMediaRecorder extends EventTarget {
  static latest: FakeMediaRecorder;
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  readonly mimeType = "audio/webm;codecs=opus";
  constructor(readonly stream: FakeStream) {
    super();
    FakeMediaRecorder.latest = this;
  }
  start(): void {
    this.state = "recording";
    setTimeout(() => this.dispatchEvent(new Event("start")), 0);
  }
  stop(): void {
    if (this.state === "inactive") return;
    this.#end();
  }
  /** What Chrome does when every track of the stream ends (microphone unplugged). */
  tracksEnded(): void {
    this.#end();
  }
  #end(): void {
    this.state = "inactive";
    setTimeout(() => {
      this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["opus"]) }));
      this.dispatchEvent(new Event("stop"));
    }, 0);
  }
}

class FakeStream {
  readonly track = { stop: vi.fn() };
  getTracks() {
    return [this.track];
  }
}

const settle = <T>(promise: Promise<T>, ms = 200): Promise<T | "timed out"> =>
  Promise.race([promise, new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), ms))]);

describe("MicrophoneRecording", () => {
  beforeEach(() => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => new FakeStream() } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the recording and releases the microphone on a normal stop", async () => {
    const recording = await MicrophoneRecording.start();
    const blob = await settle(recording.stop());
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).size).toBeGreaterThan(0);
    expect(FakeMediaRecorder.latest.stream.track.stop).toHaveBeenCalled();
    expect(recording.endedEarlyAt).toBeUndefined();
  });

  it("still resolves stop() when the recorder already stopped on its own (microphone unplugged)", async () => {
    const recording = await MicrophoneRecording.start();
    FakeMediaRecorder.latest.tracksEnded();
    await new Promise((resolve) => setTimeout(resolve, 10)); // the stop event has fired by now

    const blob = await settle(recording.stop());
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).size).toBeGreaterThan(0); // the audio recorded before the loss is kept
    expect(recording.endedEarlyAt).toBeTypeOf("number");
  });

  it("resolves stop() after a recorder error even if no stop event follows", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const starting = MicrophoneRecording.start();
      await vi.advanceTimersByTimeAsync(0);
      const recording = await starting;
      const recorder = FakeMediaRecorder.latest;
      recorder.state = "inactive";
      recorder.dispatchEvent(new Event("error"));
      const stopped = recording.stop();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await stopped).toBeInstanceOf(Blob);
    } finally {
      vi.useRealTimers();
    }
  });
});
