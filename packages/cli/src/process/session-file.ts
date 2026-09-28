import { readFile } from "node:fs/promises";
import path from "node:path";
import { SCHEMA_VERSION, type CapturedEvent, type ElementInfo, type SessionFile } from "@pointcast/core";
import { CliError } from "../errors";

/**
 * Reads and validates `<sessionDir>/session.json`. Hand-rolled rather than a schema library
 * (D10/task conventions: no new dependency for this) — schema.ts is the source of truth, so
 * this only re-checks what the CLI actually relies on (schemaVersion 1 or 2, the audio file name,
 * and enough of each event's shape to fuse/render safely) and always names the bad field, so
 * a mistake in a hand-edited fixture or an older/newer recorder version is easy to fix.
 */
export async function readSessionFile(sessionDir: string): Promise<SessionFile> {
  const filePath = path.join(sessionDir, "session.json");
  const raw = await readFile(filePath, "utf8").catch(() => {
    throw new CliError(`No session.json in ${sessionDir}. Is this a pointcast session folder?`);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CliError(`${filePath} is not valid JSON: ${(cause as Error).message}`);
  }

  return validateSessionFile(parsed, filePath);
}

/** Exported for tests; keeps the field-by-field checks separate from file I/O. */
export function validateSessionFile(value: unknown, sourceLabel: string): SessionFile {
  const fail = (field: string, expected: string): never => {
    throw new CliError(`${sourceLabel}: "${field}" ${expected}.`);
  };
  if (typeof value !== "object" || value === null) fail("$", "must be a JSON object");
  const obj = value as Record<string, unknown>;

  // Every version the format has had: v2 only made `audio` optional (schema.ts).
  const schemaVersion = obj.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== SCHEMA_VERSION) {
    fail(
      "schemaVersion",
      `must be 1 or ${SCHEMA_VERSION} (got ${JSON.stringify(schemaVersion)}) — recorded by an incompatible pointcast version`,
    );
  }
  if (typeof obj.id !== "string" || obj.id === "") fail("id", "must be a non-empty string");
  if (typeof obj.startedAt !== "string" || obj.startedAt === "") fail("startedAt", "must be a non-empty string");
  if (typeof obj.t0 !== "number" || !Number.isFinite(obj.t0)) fail("t0", "must be a number");
  if (typeof obj.durationMs !== "number" || !Number.isFinite(obj.durationMs)) fail("durationMs", "must be a number");

  // v2 sessions leave `audio` out when the audio was not saved; v1 always had it.
  if (obj.audio !== undefined || schemaVersion === 1) validateAudio(obj.audio, fail);

  const recorder = obj.recorder as Record<string, unknown>;
  if (typeof obj.recorder !== "object" || obj.recorder === null) fail("recorder", "must be an object");
  if (typeof recorder.extensionVersion !== "string") fail("recorder.extensionVersion", "must be a string");
  if (typeof recorder.userAgent !== "string") fail("recorder.userAgent", "must be a string");

  // Absent means voice: every session before typed mode (D12).
  if (obj.inputMode !== undefined && obj.inputMode !== "voice" && obj.inputMode !== "typed") {
    fail("inputMode", 'must be "voice" or "typed" when present');
  }

  if (!Array.isArray(obj.events)) fail("events", "must be an array");
  const events = (obj.events as unknown[]).map((event, index) => validateEvent(event, index, fail));

  return {
    schemaVersion: schemaVersion as SessionFile["schemaVersion"],
    id: obj.id as string,
    startedAt: obj.startedAt as string,
    t0: obj.t0 as number,
    durationMs: obj.durationMs as number,
    // Left out rather than set to undefined, so the object reads like the file.
    ...(obj.audio === undefined ? {} : { audio: obj.audio as SessionFile["audio"] }),
    recorder: recorder as SessionFile["recorder"],
    events,
    ...(obj.inputMode === undefined ? {} : { inputMode: obj.inputMode as SessionFile["inputMode"] }),
  };
}

function validateAudio(value: unknown, fail: (field: string, expected: string) => never): void {
  // Cast (rather than declare `| undefined` and rely on control-flow narrowing through the
  // shared `fail` helper) to match validateEvent/validateElement below: every field access
  // here is still guarded by an explicit runtime check on the line above it.
  const audio = value as Record<string, unknown>;
  if (typeof value !== "object" || value === null) fail("audio", "must be an object");
  if (typeof audio.file !== "string" || audio.file === "") fail("audio.file", "must be a non-empty string");
  // A session folder may come from someone else (a shared bug report). "../../Recordings/x.wav"
  // would make the CLI read, and with --engine openai upload, a file outside the folder.
  if (!isPlainFileName(audio.file as string)) {
    fail("audio.file", `must be a file name inside the session folder, without any path (got ${JSON.stringify(audio.file)})`);
  }
  if (audio.format !== "wav") fail("audio.format", 'must be "wav"');
  if (typeof audio.sampleRate !== "number") fail("audio.sampleRate", "must be a number");
  if (typeof audio.channels !== "number") fail("audio.channels", "must be a number");
}

/** No separators of either OS, no drive letter, and not "." or "..". */
export function isPlainFileName(name: string): boolean {
  return !/[\\/:]/.test(name) && name !== "." && name !== ".." && name.trim() !== "";
}

function validateEvent(
  value: unknown,
  index: number,
  fail: (field: string, expected: string) => never,
): CapturedEvent {
  const at = (field: string) => `events[${index}].${field}`;
  if (typeof value !== "object" || value === null) fail(at("$"), "must be an object");
  const event = value as Record<string, unknown>;

  if (typeof event.id !== "string" || event.id === "") fail(at("id"), "must be a non-empty string");
  if (event.gesture !== "point" && event.gesture !== "click" && event.gesture !== "select") {
    fail(at("gesture"), 'must be "point", "click" or "select"');
  }
  if (typeof event.tStart !== "number") fail(at("tStart"), "must be a number");
  if (typeof event.tEnd !== "number") fail(at("tEnd"), "must be a number");
  if (typeof event.url !== "string") fail(at("url"), "must be a string");

  const element = validateElement(event.element, at("element"), fail);
  if (event.note !== undefined && typeof event.note !== "string") fail(at("note"), "must be a string when present");

  return {
    id: event.id as string,
    gesture: event.gesture as CapturedEvent["gesture"],
    tStart: event.tStart as number,
    tEnd: event.tEnd as number,
    url: event.url as string,
    element,
    selection: event.selection as CapturedEvent["selection"],
    ...(event.note === undefined ? {} : { note: event.note as string }),
  };
}

function validateElement(
  value: unknown,
  field: string,
  fail: (field: string, expected: string) => never,
): ElementInfo {
  if (typeof value !== "object" || value === null) fail(field, "must be an object");
  const element = value as Record<string, unknown>;

  if (typeof element.tag !== "string") fail(`${field}.tag`, "must be a string");
  if (typeof element.text !== "string") fail(`${field}.text`, "must be a string");
  if (typeof element.selector !== "string") fail(`${field}.selector`, "must be a string");
  if (typeof element.selectorUnique !== "boolean") fail(`${field}.selectorUnique`, "must be a boolean");
  if (typeof element.path !== "string") fail(`${field}.path`, "must be a string");
  if (typeof element.html !== "string") fail(`${field}.html`, "must be a string");

  return element as unknown as ElementInfo;
}
