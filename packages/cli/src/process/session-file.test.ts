import { describe, expect, it } from "vitest";
import { validateSessionFile } from "./session-file";

function validSession(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "2026-01-01_00-00-00",
    startedAt: "2026-01-01T00:00:00.000Z",
    t0: 1,
    durationMs: 1000,
    audio: { file: "audio.wav", format: "wav", sampleRate: 16000, channels: 1 },
    recorder: { extensionVersion: "0.1.0", userAgent: "test" },
    events: [
      {
        id: "e1",
        gesture: "click",
        tStart: 0,
        tEnd: 0,
        url: "http://localhost/",
        element: { tag: "button", text: "Go", selector: "#go", selectorUnique: true, path: "button", html: "<button>Go</button>" },
      },
    ],
  };
}

describe("validateSessionFile", () => {
  it("keeps a typed session's inputMode and notes (D12), and rejects other values", () => {
    const value: Record<string, unknown> = { ...validSession(), schemaVersion: 2, audio: undefined, inputMode: "typed" };
    (value.events as Record<string, unknown>[])[0]!.note = "Export only the filtered rows";
    const session = validateSessionFile(value, "session.json");
    expect(session.inputMode).toBe("typed");
    expect(session.events[0]?.note).toBe("Export only the filtered rows");
    // Older sessions have neither: nothing is added.
    const voice = validateSessionFile(validSession(), "session.json");
    expect("inputMode" in voice).toBe(false);
    expect("note" in voice.events[0]!).toBe(false);
    expect(() => validateSessionFile({ ...value, inputMode: "keyboard" }, "session.json")).toThrow(/"inputMode"/);
    (value.events as Record<string, unknown>[])[0]!.note = 3;
    expect(() => validateSessionFile(value, "session.json")).toThrow(/events\[0\]\.note/);
  });

  it("accepts a well-formed session.json", () => {
    const session = validateSessionFile(validSession(), "session.json");
    expect(session.id).toBe("2026-01-01_00-00-00");
    expect(session.events).toHaveLength(1);
  });

  it("names the field on an unknown schemaVersion", () => {
    const raw = { ...validSession(), schemaVersion: 3 };
    expect(() => validateSessionFile(raw, "session.json")).toThrowError(/schemaVersion.*must be 1 or 2/);
  });

  it("accepts v2 with or without audio, and keeps the version it read", () => {
    const withAudio = validateSessionFile({ ...validSession(), schemaVersion: 2 }, "session.json");
    expect(withAudio.schemaVersion).toBe(2);
    expect(withAudio.audio?.file).toBe("audio.wav");

    const raw: Record<string, unknown> = { ...validSession(), schemaVersion: 2 };
    delete raw.audio;
    const withoutAudio = validateSessionFile(raw, "session.json");
    expect(withoutAudio).not.toHaveProperty("audio");
    expect(withoutAudio.events).toHaveLength(1);
  });

  it("still requires audio in v1, where it was always written", () => {
    const raw = validSession();
    delete raw.audio;
    expect(() => validateSessionFile(raw, "session.json")).toThrowError(/"audio" must be an object/);
  });

  it("validates audio in v2 when it is present", () => {
    const raw = { ...validSession(), schemaVersion: 2, audio: { file: "../x.wav", format: "wav", sampleRate: 16000, channels: 1 } };
    expect(() => validateSessionFile(raw, "session.json")).toThrowError(/audio\.file.*without any path/);
  });

  it("names the field for a missing required top-level field", () => {
    const raw = validSession();
    delete raw.durationMs;
    expect(() => validateSessionFile(raw, "session.json")).toThrowError(/durationMs/);
  });

  it("names the field for a missing nested audio field", () => {
    const raw = validSession();
    raw.audio = { format: "wav", sampleRate: 16000, channels: 1 };
    expect(() => validateSessionFile(raw, "session.json")).toThrowError(/audio\.file/);
  });

  it("rejects an audio.file that points outside the session folder", () => {
    const outside = ["../../../Recordings/meeting.wav", "..\\secret.wav", "/etc/audio.wav", "C:\\x.wav", "C:x.wav", "..", "sub/audio.wav"];
    for (const file of outside) {
      const raw = validSession();
      raw.audio = { file, format: "wav", sampleRate: 16000, channels: 1 };
      expect(() => validateSessionFile(raw, "session.json"), file).toThrowError(/audio\.file.*without any path/);
    }
  });

  it("names the field for a malformed event", () => {
    const raw = validSession();
    raw.events = [{ id: "e1", gesture: "not-a-gesture", tStart: 0, tEnd: 0, url: "x", element: {} }];
    expect(() => validateSessionFile(raw, "session.json")).toThrowError(/events\[0\]\.gesture/);
  });

  it("keeps debug capture's errors (D13), bounded, and drops malformed ones without failing", () => {
    const raw = validSession();
    const error = { kind: "network", t: 5, message: "POST /api/export → 500", request: { method: "POST", url: "/api/export", status: 500 } };
    (raw.events as Record<string, unknown>[])[0]!.errors = [error, { kind: "nope" }];
    raw.errors = [error, "junk"];
    const session = validateSessionFile(raw, "session.json");
    expect(session.events[0]?.errors).toEqual([error]);
    expect(session.errors).toEqual([error]);
    raw.errors = "not a list";
    expect(validateSessionFile(raw, "session.json")).not.toHaveProperty("errors");
    delete raw.errors;
    expect(validateSessionFile(validSession(), "session.json")).not.toHaveProperty("errors");
  });

  it("rejects a non-object root", () => {
    expect(() => validateSessionFile(null, "session.json")).toThrowError();
    expect(() => validateSessionFile("nope", "session.json")).toThrowError();
  });
});
