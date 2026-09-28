import type { TimeSpan, Word } from "@pointcast/core";
import { SAMPLE_RATE } from "./chunks";
import { dropReemittedWords } from "./monotonic";

/**
 * Where to cut a recording that is still going on, so each finished piece can be transcribed
 * while the user keeps talking and only the last piece is left after Stop (D1 note 2026-09-27,
 * live transcription).
 *
 * Pieces are 15-30 s: at least 15 s so Whisper has context and the model is not called for
 * every short pause, at most 30 s because that is Whisper's window (a longer piece would be
 * chunked again, with the overlap problems monotonic.ts deals with).
 *
 * Pieces never overlap, so a word can only be lost or doubled if a cut falls inside it. Cuts
 * therefore go in the middle of the quietest 300 ms of the allowed range, and only if that is a
 * real pause (much quieter than the speech around it); a piece of 30 s with no pause at all (rare:
 * people breathe) is cut at its quietest point anyway.
 */
export const MIN_SEGMENT_S = 15;
export const MAX_SEGMENT_S = 30;

const FRAME = SAMPLE_RATE / 50; // 20 ms
const PAUSE_FRAMES = 15; // 300 ms: a short pause between phrases
/** The newest audio may still change (the recorder hands it over in 1 s pieces): never cut there. */
const END_GUARD = SAMPLE_RATE;
/** A pause is at most this fraction of the piece's RMS level (-20 dB) … */
const PAUSE_RATIO = 0.1;
/** … or below this absolute level (-60 dBFS), for a piece that is mostly silence. */
const PAUSE_FLOOR = 0.001;

/**
 * The sample index to cut at, between `from + 15 s` and `from + 30 s`, or undefined to wait for
 * more audio. `samples` is everything recorded so far (16 kHz mono); `from` is the previous cut.
 */
export function findCut(samples: Float32Array, from: number): number | undefined {
  const earliest = from + MIN_SEGMENT_S * SAMPLE_RATE;
  const hardCap = from + MAX_SEGMENT_S * SAMPLE_RATE;
  const latest = Math.min(hardCap, samples.length - END_GUARD);
  if (latest < earliest) return undefined;

  // Energy of each 20 ms frame from `from`, as a running sum so every 300 ms window costs O(1).
  const half = (PAUSE_FRAMES * FRAME) / 2;
  const frames = Math.floor((latest + half - from) / FRAME);
  const sums = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) {
    let energy = 0;
    for (let i = from + f * FRAME, end = i + FRAME; i < end; i++) energy += samples[i]! * samples[i]!;
    sums[f + 1] = sums[f]! + energy;
  }

  const windowEnergy = (f: number) => sums[f + PAUSE_FRAMES]! - sums[f]!;
  const firstWindow = Math.floor((earliest - half - from) / FRAME);
  const lastWindow = frames - PAUSE_FRAMES;
  let quietest = firstWindow;
  for (let f = firstWindow; f <= lastWindow; f++) if (windowEnergy(f) < windowEnergy(quietest)) quietest = f;
  const bestEnergy = windowEnergy(quietest);
  // A pause longer than 300 ms has many equally quiet windows: cut in the middle of them, as far
  // as possible from the words on both sides.
  const asQuiet = (f: number) => windowEnergy(f) <= bestEnergy * 1.5 + 1e-9;
  let runStart = quietest;
  let runEnd = quietest;
  while (runStart > firstWindow && asQuiet(runStart - 1)) runStart--;
  while (runEnd < lastWindow && asQuiet(runEnd + 1)) runEnd++;
  const middle = Math.round((runStart + runEnd) / 2);
  const best = Math.min(Math.max(from + middle * FRAME + half, earliest), latest);

  const rms = (energy: number, count: number) => Math.sqrt(energy / count);
  const pauseRms = rms(bestEnergy, PAUSE_FRAMES * FRAME);
  const pieceRms = rms(sums[frames]!, frames * FRAME);
  const isPause = pauseRms <= Math.max(PAUSE_FLOOR, PAUSE_RATIO * pieceRms);
  return isPause || latest === hardCap ? best : undefined;
}

/**
 * Joins the words of consecutive pieces into one time line: each piece's times are relative to
 * its own start, given in samples. The join is checked like any long transcript (monotonic.ts).
 */
export function joinSegments(segments: readonly { startSample: number; words: readonly Word[] }[]): Word[] {
  const words = segments.flatMap(({ startSample, words }) => {
    const offsetMs = offset(startSample);
    return words.map((word) => ({ ...word, start: word.start + offsetMs, end: word.end + offsetMs }));
  });
  return dropReemittedWords(words);
}

/** The pieces' unreliable stretches (WordsFile.unreliable), shifted onto the recording's time line. */
export function joinUnreliable(segments: readonly { startSample: number; unreliable?: readonly TimeSpan[] }[]): TimeSpan[] {
  return segments.flatMap(({ startSample, unreliable = [] }) =>
    unreliable.map((span) => ({ start: span.start + offset(startSample), end: span.end + offset(startSample) })),
  );
}

function offset(startSample: number): number {
  return Math.round((startSample * 1000) / SAMPLE_RATE);
}
