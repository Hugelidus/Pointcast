import { describe, expect, it, vi } from "vitest";
import type { CapturedEvent, SessionFile, WordsFile } from "@pointcast/core";
import type { TranscribeDone } from "../transcriber/protocol";
import { processSession, type ProcessingJob, type ProcessorDeps, type SessionFileBlob } from "./session-processor";

const T0 = Date.UTC(2026, 8, 27, 10, 0, 0);

const event: CapturedEvent = {
  id: "e1",
  gesture: "point",
  tStart: 1_100,
  tEnd: 1_100,
  url: "http://localhost:5511/",
  element: {
    tag: "th",
    text: "Quantity",
    selector: "#orders th:nth-of-type(3)",
    selectorUnique: true,
    path: "main › table › th[3]",
    html: "<th>Quantity</th>",
  },
};

const WORDS: WordsFile = {
  schemaVersion: 1,
  engine: "local:Xenova/whisper-base",
  language: "es",
  words: [
    { text: " Esto", start: 1_000, end: 1_300 },
    { text: " ordénalo.", start: 1_400, end: 2_000 },
  ],
};

function job(extra: Partial<ProcessingJob> = {}): ProcessingJob {
  return {
    sessionId: "2026-09-27_12-00-00",
    t0: T0,
    events: [event],
    extensionVersion: "0.1.0",
    userAgent: "UA",
    // 3 s of 16 kHz audio.
    audio: { decoded: true, samples: new Float32Array(48_000) },
    warnings: [],
    options: { keepAudio: false, deadline: T0 + 600_000, handoff: true },
    ...extra,
  };
}

function deps(done: Partial<TranscribeDone> = {}): ProcessorDeps & { copy: ReturnType<typeof vi.fn> } {
  return {
    transcribe: vi.fn(async () => ({ type: "done" as const, words: WORDS, loadMs: 1_200, transcribeMs: 900, ...done })),
    copy: vi.fn(async (_text: string) => undefined),
  };
}

const names = (files: SessionFileBlob[]) => files.map((file) => file.fileName);
async function json<T>(files: SessionFileBlob[], name: string): Promise<T> {
  const file = files.find((f) => f.fileName === name);
  if (!file) throw new Error(`${name} missing`);
  return JSON.parse(await file.blob.text()) as T;
}

describe("processSession", () => {
  it("renders the Markdown, copies it, and saves it with words.json and a v2 session.json without audio", async () => {
    const d = deps();
    const result = await processSession(job(), d);

    expect(names(result.files)).toEqual(["session.md", "words.json", "session.json"]);
    // The default spec format is "requests" (docs/eval/results-2026-09-27.md).
    expect(result.markdown).toContain("> Esto [a] ordénalo.\n\n- [a] th «Quantity» on `/`");
    expect(d.copy).toHaveBeenCalledWith(result.markdown);
    expect(await result.files[0]?.blob.text()).toBe(result.markdown);
    expect(result).toMatchObject({ copied: true, language: "es", audioMs: 3_000, timings: { loadMs: 1_200, transcribeMs: 900 } });
    expect(result.error).toBeUndefined();
    expect(result.warning).toBeUndefined();
    const session = await json<SessionFile>(result.files, "session.json");
    expect(session).toMatchObject({ schemaVersion: 2, id: "2026-09-27_12-00-00", durationMs: 3_000, events: [event] });
    expect(session).not.toHaveProperty("audio");
    expect(await json<WordsFile>(result.files, "words.json")).toEqual(WORDS);
  });

  it("resolves the code pointers while transcribing: `text at:` in the spec and session.json, one line for the popup", async () => {
    const d = deps();
    let transcribeStarted = false;
    d.transcribe = vi.fn(async () => {
      transcribeStarted = true;
      return { type: "done" as const, words: WORDS, loadMs: 0, transcribeMs: 1 };
    });
    const withChain: CapturedEvent = {
      ...event,
      element: { ...event.element, renderedBy: [{ component: "OrdersTable", file: "src/pages/Orders.svelte", line: 12 }] },
    };
    const resolveCode = vi.fn(async (session: SessionFile) => {
      // Started before Whisper: the events are final at Stop.
      expect(transcribeStarted).toBe(false);
      const [first] = session.events;
      if (!first) throw new Error("no event");
      const resolved = { ...first, element: { ...first.element, resolved: [{ kind: "text" as const, file: "src/pages/Orders.svelte", line: 14, via: "dev-server" as const }] } };
      return { session: { ...session, events: [resolved] }, note: "Code pointer: 1 location found in the source the dev server serves." };
    });
    const result = await processSession(job({ events: [withChain] }), { ...d, resolveCode });

    expect(result.markdown).toContain("  - text at: `src/pages/Orders.svelte:14`");
    expect(result.code).toBe("Code pointer: 1 location found in the source the dev server serves.");
    const session = await json<SessionFile>(result.files, "session.json");
    expect(session.events[0]?.element.resolved).toEqual([{ kind: "text", file: "src/pages/Orders.svelte", line: 14, via: "dev-server" }]);
  });

  it("renders the spec as captured when resolving the code pointers fails", async () => {
    const plain = await processSession(job(), deps());
    const failing = await processSession(job(), {
      ...deps(),
      resolveCode: async () => {
        throw new Error("bug");
      },
    });
    expect(failing.markdown).toBe(plain.markdown);
    expect(failing.code).toBeUndefined();
  });

  it("adds audio.wav when the user keeps the audio", async () => {
    const result = await processSession(job({ options: { keepAudio: true, deadline: 0, handoff: true } }), deps());
    expect(names(result.files)).toEqual(["session.md", "words.json", "session.json", "audio.wav"]);
    expect((await json<SessionFile>(result.files, "session.json")).audio).toEqual({
      file: "audio.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    });
    expect(result.files[3]?.blob.size).toBe(44 + 48_000 * 2);
  });

  it("says which language it fell back to, and keeps the audio so the CLI can redo it", async () => {
    const result = await processSession(
      job(),
      deps({ fallback: { guess: { code: "fr", probability: 0.45 }, used: "es", reason: "last-used" } }),
    );
    expect(result.warning).toBe(
      "Not sure which language you spoke (best guess French, 45 % sure), so it was transcribed as Spanish, the language of " +
        "your last session. If that is wrong, pick the language in the popup; the audio was kept for the CLI.",
    );
    expect(names(result.files)).toContain("audio.wav");
  });

  it("still saves the Markdown when the clipboard refuses, and says how to copy it", async () => {
    const d = deps();
    d.copy.mockRejectedValue(new Error("the browser refused to copy"));
    const result = await processSession(job(), d);
    expect(result.copied).toBe(false);
    expect(result.warning).toMatch(/Could not copy to the clipboard \(the browser refused to copy\): use Copy again/);
    expect(names(result.files)).toContain("session.md");
  });

  it("saves the session with its audio when transcription fails, for the CLI", async () => {
    const d: ProcessorDeps = { transcribe: async () => Promise.reject(new Error("Transcription took too long and was stopped.")), copy: vi.fn() };
    const result = await processSession(job({ warnings: ["The microphone stopped by itself."] }), d);
    expect(names(result.files)).toEqual(["session.json", "audio.wav"]);
    expect((await json<SessionFile>(result.files, "session.json")).audio?.file).toBe("audio.wav");
    expect(result.error).toBe(
      "Could not transcribe: Transcription took too long and was stopped. The events and the audio were saved in the " +
        'session folder, so "pointcast process" can finish it. The microphone stopped by itself.',
    );
    expect(result.markdown).toBeUndefined();
    expect(d.copy).not.toHaveBeenCalled();
  });

  it("keeps the events and the raw recording when the audio could not be decoded", async () => {
    const raw = new Blob(["webm bytes"], { type: "audio/webm" });
    const d = deps();
    const result = await processSession(job({ audio: { decoded: false, raw, durationMs: 4_000, error: "Unable to decode" } }), d);
    expect(names(result.files)).toEqual(["session.json", "audio.webm"]);
    expect(await result.files[1]?.blob.text()).toBe("webm bytes");
    expect(result.error).toMatch(/could not be converted \(Unable to decode\).*ffmpeg -i audio\.webm/);
    expect((await json<SessionFile>(result.files, "session.json")).events).toHaveLength(1);
    expect(d.transcribe).not.toHaveBeenCalled();
  });

  it("does not start Whisper for an empty recording", async () => {
    const d = deps();
    const result = await processSession(job({ audio: { decoded: true, samples: new Float32Array(0) } }), d);
    expect(d.transcribe).not.toHaveBeenCalled();
    expect(result).toMatchObject({ copied: true, audioMs: 0 });
    expect(result.timings).toBeUndefined();
  });
});
