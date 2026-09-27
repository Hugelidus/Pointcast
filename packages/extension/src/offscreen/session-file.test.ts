import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type CapturedEvent } from "@pointcast/core";
import { buildSessionFile } from "./session-file";

describe("buildSessionFile", () => {
  const t0 = Date.UTC(2026, 8, 26, 16, 30, 5, 123);
  const event: CapturedEvent = {
    id: "e1",
    gesture: "point",
    tStart: 3820,
    tEnd: 3820,
    url: "http://localhost:5511/",
    element: { tag: "th", text: "Quantity", selector: "th", selectorUnique: false, path: "th", html: "<th>Quantity</th>" },
  };

  const session = buildSessionFile({
    id: "2026-09-26_18-30-05",
    t0,
    durationMs: 14250,
    events: [event],
    extensionVersion: "0.1.0",
    userAgent: "UA",
    withAudio: true,
  });

  it("fills every field of the session contract", () => {
    expect(session).toEqual({
      schemaVersion: SCHEMA_VERSION,
      id: "2026-09-26_18-30-05",
      startedAt: "2026-09-26T16:30:05.123Z",
      t0,
      durationMs: 14250,
      audio: { file: "audio.wav", format: "wav", sampleRate: 16000, channels: 1 },
      recorder: { extensionVersion: "0.1.0", userAgent: "UA" },
      events: [event],
    });
  });

  it("leaves the audio out when it is not saved (v2)", () => {
    const withoutAudio = buildSessionFile({
      id: "2026-09-26_18-30-05",
      t0,
      durationMs: 14250,
      events: [],
      extensionVersion: "0.1.0",
      userAgent: "UA",
      withAudio: false,
    });
    expect(withoutAudio).not.toHaveProperty("audio");
    expect(withoutAudio.schemaVersion).toBe(2);
  });

  it("serializes to JSON without losing anything", () => {
    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
  });
});
