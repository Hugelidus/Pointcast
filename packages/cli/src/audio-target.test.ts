import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAudioSamples } from "./audio/read-audio";
import { resolveAudioTarget } from "./audio-target";
import { CliError } from "./errors";

const session = (audioFile: string) =>
  JSON.stringify({
    schemaVersion: 1,
    id: "2026-01-01_00-00-00",
    startedAt: "2026-01-01T00:00:00.000Z",
    t0: 1,
    durationMs: 1000,
    audio: { file: audioFile, format: "wav", sampleRate: 16000, channels: 1 },
    recorder: { extensionVersion: "0.1.0", userAgent: "test" },
    events: [],
  });

describe("resolveAudioTarget (pointcast transcribe <target>)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pointcast-cli-target-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses a .wav file directly and writes words.json next to it", async () => {
    const wav = join(dir, "clip.wav");
    writeFileSync(wav, "");
    expect(await resolveAudioTarget(wav)).toEqual({ audioPath: wav, wordsPath: join(dir, "words.json") });
  });

  it("rejects a file that is not a .wav", async () => {
    const other = join(dir, "clip.mp3");
    writeFileSync(other, "");
    await expect(resolveAudioTarget(other)).rejects.toThrow(/Expected a \.wav file/);
  });

  it("reads the audio file name from session.json in a session directory", async () => {
    writeFileSync(join(dir, "session.json"), session("recording.wav"));
    expect(await resolveAudioTarget(dir)).toEqual({ audioPath: join(dir, "recording.wav"), wordsPath: join(dir, "words.json") });
  });

  it("defaults to audio.wav in a folder without session.json", async () => {
    expect((await resolveAudioTarget(dir)).audioPath).toBe(join(dir, "audio.wav"));
  });

  it("gives a one-line error for a half-written session.json instead of a stack trace", async () => {
    writeFileSync(join(dir, "session.json"), '{"schemaVersion": 1, "audio": ');
    await expect(resolveAudioTarget(dir)).rejects.toThrow(CliError);
    await expect(resolveAudioTarget(dir)).rejects.toThrow(/not valid JSON/);
  });

  it("refuses an audio file outside the session folder", async () => {
    writeFileSync(join(dir, "session.json"), session("../../private.wav"));
    await expect(resolveAudioTarget(dir)).rejects.toThrow(/audio\.file/);
  });

  it("explains that a v2 session saved without audio has nothing to transcribe", async () => {
    const { audio: _audio, ...rest } = JSON.parse(session("audio.wav")) as Record<string, unknown>;
    writeFileSync(join(dir, "session.json"), JSON.stringify({ ...rest, schemaVersion: 2 }));
    await expect(resolveAudioTarget(dir)).rejects.toThrow(/saved without audio/);
  });

  it("reports a missing target", async () => {
    await expect(resolveAudioTarget(join(dir, "nope"))).rejects.toThrow(/No such file or directory/);
  });
});

describe("readAudioSamples", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pointcast-cli-audio-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("explains how to convert the raw recording the extension saved when WAV conversion failed", async () => {
    writeFileSync(join(dir, "audio.webm"), "raw");
    await expect(readAudioSamples(join(dir, "audio.wav"))).rejects.toThrow(/ffmpeg -i .*audio\.webm.* -ar 16000 -ac 1/);
  });

  it("says the audio is missing otherwise", async () => {
    await expect(readAudioSamples(join(dir, "audio.wav"))).rejects.toThrow(/Audio file not found/);
  });
});
