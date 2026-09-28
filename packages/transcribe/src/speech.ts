import { SAMPLE_RATE } from "./chunks";

/**
 * Where the speech is, and how to hand Whisper only that part (D1 note 2026-09-28, silence).
 *
 * Why: Whisper was trained on audio that nearly always contains speech, so on silence or room
 * noise it invents some ("¡Adiós!", "Gracias.", "Thank you.") or loops on a phrase. The
 * reference implementation limits this with a no-speech threshold and a temperature fallback;
 * transformers.js has neither. So speech is found first (Silero VAD, vad.ts) and only the speech,
 * with a little padding, is transcribed. Everything here is pure, so it is unit-tested on
 * synthetic probabilities.
 */

/** A stretch of the recording, in samples: [start, end). */
export interface SampleRange {
  start: number;
  end: number;
}

/** Silero VAD looks at 512 samples (32 ms) at 16 kHz per step. */
export const VAD_FRAME = 512;

/**
 * Silero's own defaults (its `get_speech_timestamps`): speech starts at probability 0.5 and ends
 * below 0.35, so a flicker around 0.5 does not cut a word in two.
 */
const START_THRESHOLD = 0.5;
const END_THRESHOLD = 0.35;
/** Speech ends after this much audio below END_THRESHOLD (Silero's default is 100 ms). */
const MIN_SILENCE_SAMPLES = 0.1 * SAMPLE_RATE;
/**
 * Shorter bursts are not speech: a click, a key, a cup on the table. Silero's default. The
 * shortest real utterance ("sí", "no") lasts longer once its vowel is counted.
 */
const MIN_SPEECH_SAMPLES = 0.25 * SAMPLE_RATE;
/**
 * Audio kept on each side of the speech. Silero marks voiced sound, so soft word edges
 * ("s", "f", a trailing "s") can fall just outside it. faster-whisper's default.
 */
export const SPEECH_PAD_SAMPLES = 0.4 * SAMPLE_RATE;
/**
 * Only silences at least this long are taken out; shorter pauses reach Whisper as spoken.
 * faster-whisper's default, and measured here too (2026-09-28, fixtures/audio): cutting every
 * pause the VAD finds left Whisper with phrases butted together, and it dropped the first
 * sentence of en-short (25 % of words right instead of 69 %).
 */
export const MIN_SILENCE_TO_CUT = 2 * SAMPLE_RATE;
/**
 * Before the first phrase, up to this much of the recording is kept instead of the padding.
 * Every recording starts with a short silence (Record, then speak), and Whisper, trained on
 * subtitles that rarely start on the first syllable, writes better with it: with only the
 * padding, the e2e fixture's recording (2 s of silence first) came out without capitals or
 * punctuation and lost a word (87.5 % instead of 93.8 %). With 2 s every fixture scores exactly
 * as without the VAD.
 */
export const LEAD_IN_SAMPLES = 2 * SAMPLE_RATE;

/**
 * Speech regions from Silero's per-frame speech probabilities (frame i covers samples
 * [i * VAD_FRAME, (i + 1) * VAD_FRAME)), without padding. `totalSamples` bounds the last region.
 */
export function speechRegions(probabilities: ArrayLike<number>, totalSamples: number): SampleRange[] {
  const regions: SampleRange[] = [];
  let start: number | undefined;
  let quietSince: number | undefined;
  const close = (end: number) => {
    if (start !== undefined && end - start >= MIN_SPEECH_SAMPLES) regions.push({ start, end });
    start = undefined;
    quietSince = undefined;
  };
  for (let i = 0; i < probabilities.length; i++) {
    const p = probabilities[i]!;
    const at = i * VAD_FRAME;
    if (start === undefined) {
      if (p >= START_THRESHOLD) start = at;
      continue;
    }
    if (p >= END_THRESHOLD) {
      quietSince = undefined;
    } else {
      quietSince ??= at;
      if (at + VAD_FRAME - quietSince >= MIN_SILENCE_SAMPLES) close(quietSince);
    }
  }
  close(Math.min(totalSamples, quietSince ?? probabilities.length * VAD_FRAME));
  return regions;
}

/**
 * What to transcribe: speech regions separated by less than MIN_SILENCE_TO_CUT joined with the
 * pause between them, then widened by SPEECH_PAD_SAMPLES on both sides (within the audio), and
 * by LEAD_IN_SAMPLES before the first one.
 */
export function regionsToTranscribe(speech: readonly SampleRange[], totalSamples: number): SampleRange[] {
  const joined: SampleRange[] = [];
  for (const region of speech) {
    const last = joined.at(-1);
    if (last && region.start - last.end < MIN_SILENCE_TO_CUT) last.end = region.end;
    else joined.push({ ...region });
  }
  // MIN_SILENCE_TO_CUT is more than two paddings, so padded regions never overlap.
  return joined.map(({ start, end }, index) => ({
    start: Math.max(0, start - (index === 0 ? LEAD_IN_SAMPLES : SPEECH_PAD_SAMPLES)),
    end: Math.min(totalSamples, end + SPEECH_PAD_SAMPLES),
  }));
}

/** One kept stretch: `length` samples from `from` in the recording, at `to` in the compacted audio. */
interface Piece {
  from: number;
  to: number;
  length: number;
}

/**
 * The speech regions (already padded) laid end to end, and the way back to the recording's
 * timeline. This is how faster-whisper applies its VAD too: one Whisper call on the speech keeps
 * the context between phrases, where one call per phrase would lose it and cost more.
 */
export class CompactedSpeech {
  readonly samples: Float32Array;
  readonly #pieces: Piece[];
  readonly #recordingLength: number;

  constructor(recording: Float32Array, regions: readonly SampleRange[]) {
    this.samples = new Float32Array(regions.reduce((sum, r) => sum + (r.end - r.start), 0));
    this.#pieces = [];
    this.#recordingLength = recording.length;
    let to = 0;
    for (const { start, end } of regions) {
      this.samples.set(recording.subarray(start, end), to);
      this.#pieces.push({ from: start, to, length: end - start });
      to += end - start;
    }
  }

  /**
   * A word's times (ms, in the compacted audio) on the recording's timeline. The start decides
   * which piece the word belongs to, and the end is kept inside that piece: pieces are separated
   * by padding, so no real word spans a join, but Whisper often stretches a phrase's last word
   * over whatever follows it. A word that starts after the compacted audio ends (Whisper does
   * that when it loops) is placed after the end of the recording, where the sanitizer drops it.
   */
  toRecording(startMs: number, endMs: number): { start: number; end: number } {
    const start = (startMs * SAMPLE_RATE) / 1000;
    const end = (endMs * SAMPLE_RATE) / 1000;
    const ms = (at: number) => Math.round((at * 1000) / SAMPLE_RATE);
    if (start >= this.samples.length) {
      const past = this.#recordingLength + start - this.samples.length;
      return { start: ms(past), end: ms(past + Math.max(0, end - start)) };
    }
    // The piece containing the start; a start exactly on a join belongs to the later piece.
    let piece = this.#pieces[0]!;
    for (const candidate of this.#pieces) {
      if (candidate.to <= start) piece = candidate;
      else break;
    }
    const at = (position: number) => piece.from + position - piece.to;
    return { start: ms(at(start)), end: ms(at(Math.min(end, piece.to + piece.length))) };
  }
}

/** Ranges in ms, for the sanitizer, which works on word times. */
export function rangesToMs(ranges: readonly SampleRange[]): { start: number; end: number }[] {
  return ranges.map(({ start, end }) => ({
    start: Math.round((start * 1000) / SAMPLE_RATE),
    end: Math.round((end * 1000) / SAMPLE_RATE),
  }));
}
