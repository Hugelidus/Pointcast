import { describe, expect, it, vi } from "vitest";
import { INSTRUCTION_LINES, type CapturedEvent, type SessionFile, type WordsFile } from "@pointcast/core";
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
    options: { keepAudio: false, deadline: T0 + 600_000, handoff: true, quality: "fast", instructionStyle: "intent" },
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
    // The default spec format is "requests" (docs/eval/archive/results-2026-09-27.md).
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

  it("records the popup's instruction style in session.json and words the spec with it", async () => {
    const intent = await processSession(job(), deps());
    expect((await json<SessionFile>(intent.files, "session.json")).instructionStyle).toBe("intent");
    expect(intent.markdown).toContain(INSTRUCTION_LINES.intent);

    const options = { keepAudio: false, deadline: T0 + 600_000, handoff: true, quality: "fast", instructionStyle: "precise" } as const;
    const precise = await processSession(job({ options }), deps());
    expect((await json<SessionFile>(precise.files, "session.json")).instructionStyle).toBe("precise");
    expect(precise.markdown).toContain(INSTRUCTION_LINES.precise);
    expect(precise.markdown).not.toContain(INSTRUCTION_LINES.intent);

    const typedJob = job({ events: [{ ...event, note: "Sort by this column" }], audio: { decoded: false, typed: true, durationMs: 8_000 }, options });
    const typed = await processSession(typedJob, deps());
    expect((await json<SessionFile>(typed.files, "session.json")).instructionStyle).toBe("precise");
    expect(typed.markdown).toContain(INSTRUCTION_LINES.precise);
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
    const result = await processSession(job({ options: { keepAudio: true, deadline: 0, handoff: true, quality: "fast", instructionStyle: "intent" } }), deps());
    expect(names(result.files)).toEqual(["session.md", "words.json", "session.json", "audio.wav"]);
    expect((await json<SessionFile>(result.files, "session.json")).audio).toEqual({
      file: "audio.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    });
    expect(result.files[3]?.blob.size).toBe(44 + 48_000 * 2);
  });

  // Took 14 s once on a busy windows-latest runner (13 ms locally), past the default 5 s. It is
  // the only test here that names languages, and the first Intl.DisplayNames loads ICU's locale
  // data, the likely cost; nothing in the test itself is slow to trim.
  it("says which language it fell back to, and keeps the audio so the CLI can redo it", { timeout: 30_000 }, async () => {
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

  it("warns when part of the transcript was dropped as unreliable, and the spec says so too", async () => {
    const words: WordsFile = { ...WORDS, unreliable: [{ start: 15_000, end: 30_000 }] };
    const result = await processSession(job(), deps({ words }));
    expect(result.warning).toBe("The transcript around 00:15–00:30 looked unreliable and was dropped; say it again if something is missing.");
    expect(result.markdown).toContain("the transcript around 00:15–00:30 looked unreliable");
    expect((await json<WordsFile>(result.files, "words.json")).unreliable).toEqual([{ start: 15_000, end: 30_000 }]);
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
    expect(result.error).toBe("Transcription took too long and was stopped: try a shorter recording. Your events and audio are saved.");
    expect(result.errorDetail).toMatch(/^Transcription took too long and was stopped\.\n.*"pointcast process" can transcribe it/);
    // Kept apart from the error: the error line is the one thing to act on.
    expect(result.warning).toBe("The microphone stopped by itself.");
    expect(result.markdown).toBeUndefined();
    expect(d.copy).not.toHaveBeenCalled();
  });

  it("turns a model download failure into a sentence that says what to do, keeping the raw text as the detail", async () => {
    const raw = 'Could not locate file: "https://huggingface.co/Xenova/whisper-base/resolve/main/config.json".';
    const d: ProcessorDeps = { transcribe: async () => Promise.reject(new Error(raw)), copy: vi.fn() };
    const result = await processSession(job(), d);
    expect(result.error).toBe(
      "Could not download the speech model: check your internet connection, then record again. Your events and audio are saved.",
    );
    expect(result.error).not.toContain("http");
    expect(result.errorDetail?.startsWith(raw)).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("keeps the events and the raw recording when the audio could not be decoded", async () => {
    const raw = new Blob(["webm bytes"], { type: "audio/webm" });
    const d = deps();
    const result = await processSession(job({ audio: { decoded: false, raw, durationMs: 4_000, error: "Unable to decode" } }), d);
    expect(names(result.files)).toEqual(["session.json", "audio.webm"]);
    expect(await result.files[1]?.blob.text()).toBe("webm bytes");
    expect(result.error).toBe("The audio could not be converted, so nothing was transcribed. Your events and the raw recording are saved.");
    expect(result.errorDetail).toMatch(/^Unable to decode\n.*ffmpeg -i audio\.webm/);
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

describe("processSession of a typed session (D12)", () => {
  const typedJob = (extra: Partial<ProcessingJob> = {}) =>
    job({
      events: [{ ...event, note: "Sort by this column" }],
      audio: { decoded: false, typed: true, durationMs: 8_000 },
      ...extra,
    });

  it("renders the notes at once: no transcription, no audio, no words.json, no timings", async () => {
    const d = deps();
    const result = await processSession(typedJob(), d);

    expect(d.transcribe).not.toHaveBeenCalled();
    expect(names(result.files)).toEqual(["session.md", "session.json"]);
    expect(result.markdown).toContain("> Sort by this column [a]\n\n- [a] th «Quantity» on `/`");
    expect(d.copy).toHaveBeenCalledWith(result.markdown);
    expect(result).toMatchObject({ copied: true, audioMs: 8_000 });
    expect(result.timings).toBeUndefined();
    expect(result.language).toBeUndefined();
    const session = await json<SessionFile>(result.files, "session.json");
    expect(session).toMatchObject({ inputMode: "typed", durationMs: 8_000, schemaVersion: 2 });
    expect(session.audio).toBeUndefined();
    expect(session.events[0]?.note).toBe("Sort by this column");
  });

  it("resolves the code pointers and still saves when the clipboard fails", async () => {
    const d = deps();
    d.copy.mockRejectedValue(new Error("Document is not focused"));
    const resolveCode = vi.fn(async (session: SessionFile) => ({ session, note: "Code pointer: 1 location found." }));
    const result = await processSession(typedJob(), { ...d, resolveCode });
    expect(resolveCode).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ copied: false, code: "Code pointer: 1 location found." });
    expect(result.warning).toMatch(/Copy again/);
    expect(names(result.files)).toEqual(["session.md", "session.json"]);
  });
});
