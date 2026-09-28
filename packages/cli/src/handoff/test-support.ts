import { randomBytes } from "node:crypto";
import { HANDOFF_FILE_NAMES, type HandoffFile, type HandoffFileName } from "@pointcast/core";

/** Test data shared by the store and receiver tests: one recording, as the extension sends it. */

export const SESSION_ID = "2026-09-28_10-15-00";

export interface Recording {
  /** In protocol order, as in X-Pointcast-Files. */
  files: HandoffFile[];
  /** The files' bytes concatenated in that order: the request body. */
  body: Buffer;
  bytes: Partial<Record<HandoffFileName, Buffer>>;
}

export function sessionJson(id: string): string {
  return JSON.stringify(
    {
      schemaVersion: 2,
      id,
      startedAt: "2026-09-28T08:15:00.000Z",
      t0: 0,
      durationMs: 4200,
      recorder: { extensionVersion: "0.2.0", userAgent: "test" },
      events: [],
    },
    null,
    2,
  );
}

/**
 * session.json, words.json, session.md (not ASCII, so a re-encoding would show) and a WAV that is
 * only random bytes (the receiver never sniffs audio). `overrides` replaces a file, or drops it
 * with null.
 */
export function recording(
  id: string = SESSION_ID,
  overrides: Partial<Record<HandoffFileName, Buffer | string | null>> = {},
): Recording {
  const defaults: Partial<Record<HandoffFileName, Buffer | string>> = {
    "session.json": sessionJson(id),
    "words.json": JSON.stringify({ schemaVersion: 1, engine: "test", language: "es", words: [{ text: "esto", start: 0, end: 0.4 }] }),
    "session.md": `# ${id}\n\nCambia «esto» → 👍\n`,
    "audio.wav": randomBytes(2048),
  };
  const bytes: Partial<Record<HandoffFileName, Buffer>> = {};
  for (const name of HANDOFF_FILE_NAMES) {
    const value = name in overrides ? overrides[name] : defaults[name];
    if (value === undefined || value === null) continue;
    bytes[name] = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  }
  const files = HANDOFF_FILE_NAMES.filter((name) => bytes[name] !== undefined).map((name) => ({ name, size: bytes[name]!.length }));
  return { files, body: Buffer.concat(files.map((file) => bytes[file.name]!)), bytes };
}
