import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWordsFileIfPresent, validateWordsFile, writeWordsFile } from "./words-file";

describe("validateWordsFile", () => {
  it("accepts a well-formed words.json", () => {
    const words = validateWordsFile(
      { schemaVersion: 1, engine: "local:test", language: "es", words: [{ text: " hi", start: 0, end: 100 }] },
      "words.json",
    );
    expect(words.words).toHaveLength(1);
  });

  it("names the field on a schemaVersion mismatch", () => {
    expect(() =>
      validateWordsFile({ schemaVersion: 2, engine: "x", words: [] }, "words.json"),
    ).toThrowError(/schemaVersion/);
  });

  it("names the field for a malformed word", () => {
    expect(() =>
      validateWordsFile({ schemaVersion: 1, engine: "x", words: [{ text: "hi" }] }, "words.json"),
    ).toThrowError(/words\[0\]\.start/);
  });
});

describe("readWordsFileIfPresent / writeWordsFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pointcast-cli-words-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined when words.json does not exist", async () => {
    await expect(readWordsFileIfPresent(dir)).resolves.toBeUndefined();
  });

  it("round-trips through writeWordsFile", async () => {
    const words = { schemaVersion: 1 as const, engine: "local:test", words: [{ text: " hi", start: 0, end: 100 }] };
    const filePath = await writeWordsFile(dir, words);

    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual(words);
    await expect(readWordsFileIfPresent(dir)).resolves.toEqual(words);
  });

  it("reports a friendly error for corrupt JSON", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "words.json"), "{ not json", "utf8");
    await expect(readWordsFileIfPresent(dir)).rejects.toThrowError(/not valid JSON/);
  });
});
