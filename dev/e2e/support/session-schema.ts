// Relative import: the repo root does not depend on the workspace packages, so the
// "@pointcast/core" name does not resolve from dev/e2e/.
import type { CapturedEvent, ElementInfo, SessionFile } from "../../../packages/core/src/schema";
import { SCHEMA_VERSION } from "../../../packages/core/src/schema";

/**
 * Structural validation of session.json against packages/core/src/schema.ts.
 * Hand-written (no JSON Schema library): the contract is small and this stays readable.
 * Throws with the path of the first problem.
 */
export function assertSessionFile(value: unknown): asserts value is SessionFile {
  const s = object(value, "session");
  equal(s["schemaVersion"], SCHEMA_VERSION, "schemaVersion");
  match(string(s["id"], "id"), /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/, "id");
  const startedAt = string(s["startedAt"], "startedAt");
  const t0 = integer(s["t0"], "t0");
  equal(new Date(startedAt).getTime(), t0, "startedAt (must be t0 as ISO 8601)");
  integer(s["durationMs"], "durationMs", 0);

  // v2: present only when the audio was saved.
  if (s["audio"] !== undefined) {
    const audio = object(s["audio"], "audio");
    equal(audio["file"], "audio.wav", "audio.file");
    equal(audio["format"], "wav", "audio.format");
    equal(audio["sampleRate"], 16000, "audio.sampleRate");
    equal(audio["channels"], 1, "audio.channels");
  }

  const recorder = object(s["recorder"], "recorder");
  string(recorder["extensionVersion"], "recorder.extensionVersion");
  string(recorder["userAgent"], "recorder.userAgent");

  const events = s["events"];
  if (!Array.isArray(events)) throw new Error("events: expected an array");
  events.forEach((event, i) => assertEvent(event, i));
}

function assertEvent(value: unknown, index: number): asserts value is CapturedEvent {
  const at = `events[${index}]`;
  const e = object(value, at);
  equal(e["id"], `e${index + 1}`, `${at}.id`);
  if (!["point", "click", "select"].includes(e["gesture"] as string)) throw new Error(`${at}.gesture: invalid`);
  const tStart = integer(e["tStart"], `${at}.tStart`, 0);
  integer(e["tEnd"], `${at}.tEnd`, tStart);
  string(e["url"], `${at}.url`);
  assertElement(e["element"], `${at}.element`);
  if (e["selection"] !== undefined) {
    const selection = object(e["selection"], `${at}.selection`);
    string(selection["text"], `${at}.selection.text`);
    if (selection["start"] !== undefined) assertElement(selection["start"], `${at}.selection.start`);
    if (selection["end"] !== undefined) assertElement(selection["end"], `${at}.selection.end`);
  }
}

function assertElement(value: unknown, at: string): asserts value is ElementInfo {
  const el = object(value, at);
  for (const key of ["tag", "text", "selector", "path", "html"]) string(el[key], `${at}.${key}`);
  if (typeof el["selectorUnique"] !== "boolean") throw new Error(`${at}.selectorUnique: expected a boolean`);
  if (el["context"] !== undefined && string(el["context"], `${at}.context`).length > 60) {
    throw new Error(`${at}.context: longer than 60 characters`);
  }
  if (el["renderedBy"] !== undefined) {
    const frames = el["renderedBy"];
    if (!Array.isArray(frames) || frames.length === 0 || frames.length > 3) {
      throw new Error(`${at}.renderedBy: expected 1 to 3 frames`);
    }
    frames.forEach((frame, i) => string(object(frame, `${at}.renderedBy[${i}]`)["file"], `${at}.renderedBy[${i}].file`));
  }
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${at}: expected an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, at: string): string {
  if (typeof value !== "string") throw new Error(`${at}: expected a string`);
  return value;
}

function integer(value: unknown, at: string, min = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(`${at}: expected an integer >= ${min}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function equal(actual: unknown, expected: unknown, at: string): void {
  if (actual !== expected) throw new Error(`${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function match(value: string, pattern: RegExp, at: string): void {
  if (!pattern.test(value)) throw new Error(`${at}: "${value}" does not match ${pattern}`);
}
