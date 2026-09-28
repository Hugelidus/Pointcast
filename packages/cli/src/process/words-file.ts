import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TimeSpan, Word, WordsFile } from "@pointcast/core";
import { CliError } from "../errors";

/**
 * Reads `<sessionDir>/words.json` if present, validating its shape; returns undefined when the
 * file does not exist so callers can decide to transcribe (session-format.md: words.json is a
 * cache — "delete it to re-transcribe"). Any other read/parse/shape error is reported, since a
 * present-but-broken cache should not be silently overwritten (surprising after --force is what
 * that is for, not a plain re-run).
 */
export async function readWordsFileIfPresent(sessionDir: string): Promise<WordsFile | undefined> {
  const filePath = path.join(sessionDir, "words.json");
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw new CliError(`Could not read ${filePath}: ${error.message}`);
  });
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CliError(`${filePath} is not valid JSON: ${(cause as Error).message}`);
  }
  return validateWordsFile(parsed, filePath);
}

/** Exported for tests; see readSessionFile's validateSessionFile for the same rationale. */
export function validateWordsFile(value: unknown, sourceLabel: string): WordsFile {
  const fail = (field: string, expected: string): never => {
    throw new CliError(`${sourceLabel}: "${field}" ${expected}.`);
  };
  if (typeof value !== "object" || value === null) fail("$", "must be a JSON object");
  const obj = value as Record<string, unknown>;

  if (obj.schemaVersion !== 1) fail("schemaVersion", `must be 1 (got ${JSON.stringify(obj.schemaVersion)})`);
  if (typeof obj.engine !== "string" || obj.engine === "") fail("engine", "must be a non-empty string");
  if (obj.language !== undefined && typeof obj.language !== "string") fail("language", "must be a string when present");
  if (!Array.isArray(obj.words)) fail("words", "must be an array");

  const words: Word[] = (obj.words as unknown[]).map((word, index) => validateWord(word, index, fail));
  // Optional since 2026-09-28 (session-format.md): files written before it have none.
  if (obj.unreliable !== undefined && !Array.isArray(obj.unreliable)) fail("unreliable", "must be an array when present");
  const unreliable = ((obj.unreliable ?? []) as unknown[]).map((span, index) => validateSpan(span, index, fail));

  return {
    schemaVersion: 1,
    engine: obj.engine as string,
    language: obj.language as string | undefined,
    words,
    ...(unreliable.length > 0 ? { unreliable } : {}),
  };
}

function validateSpan(value: unknown, index: number, fail: (field: string, expected: string) => never): TimeSpan {
  const span = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (typeof span.start !== "number") fail(`unreliable[${index}].start`, "must be a number");
  if (typeof span.end !== "number") fail(`unreliable[${index}].end`, "must be a number");
  return { start: span.start as number, end: span.end as number };
}

function validateWord(value: unknown, index: number, fail: (field: string, expected: string) => never): Word {
  const at = (field: string) => `words[${index}].${field}`;
  if (typeof value !== "object" || value === null) fail(at("$"), "must be an object");
  const word = value as Record<string, unknown>;

  if (typeof word.text !== "string") fail(at("text"), "must be a string");
  if (typeof word.start !== "number") fail(at("start"), "must be a number");
  if (typeof word.end !== "number") fail(at("end"), "must be a number");
  if (word.probability !== undefined && typeof word.probability !== "number") {
    fail(at("probability"), "must be a number when present");
  }

  return {
    text: word.text as string,
    start: word.start as number,
    end: word.end as number,
    probability: word.probability as number | undefined,
  };
}

/** Pretty-printed, like every other JSON file this project writes (session.json, fixtures). */
export async function writeWordsFile(sessionDir: string, words: WordsFile): Promise<string> {
  const filePath = path.join(sessionDir, "words.json");
  await writeFile(filePath, JSON.stringify(words, null, 2), "utf8");
  return filePath;
}
