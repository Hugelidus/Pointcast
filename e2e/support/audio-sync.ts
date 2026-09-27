/**
 * Measures where the narration of the fake microphone ended up in audio.wav.
 *
 * Chrome's fake capture device plays its file in a loop from when the device opens, which is
 * not exactly t0 (MediaRecorder's start event), and audio crosses a capture pipeline before
 * reaching the recorder. So a word said at `w` ms into the fixture is at `w + delay` ms in
 * audio.wav. Knowing the delay separates two questions: "did the gesture happen when the test
 * scheduled it" (t0 + w) and "does it line up with the word in the recorded audio", which is
 * what fusion will actually see (plan step 10).
 */

const ENVELOPE_MS = 10;

/** RMS loudness per 10 ms window, normalized to zero mean and unit variance. */
function envelope(samples: Float32Array, sampleRate: number): Float64Array {
  const size = Math.round((sampleRate * ENVELOPE_MS) / 1000);
  const count = Math.floor(samples.length / size);
  const env = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = i * size; j < (i + 1) * size; j++) sum += (samples[j] ?? 0) ** 2;
    env[i] = Math.sqrt(sum / size);
  }
  let mean = 0;
  for (const v of env) mean += v / count;
  let variance = 0;
  for (const v of env) variance += (v - mean) ** 2 / count;
  const sd = Math.sqrt(variance) || 1;
  return env.map((v) => (v - mean) / sd);
}

export interface AudioDelay {
  /**
   * How much later a moment of the fixture appears in the recording, in ms (10 ms resolution).
   * Negative when the file was already playing at t0.
   */
  delayMs: number;
  /** Correlation of the loudness envelopes at that delay; ~1 means a clear match. */
  correlation: number;
}

/**
 * Finds the delay that best explains `recorded` as the looped `source` shifted in time, by
 * correlating loudness envelopes (robust to the Opus round trip and resampling, unlike raw
 * samples). The source loops, so the delay is only known modulo its length; the answer is the
 * one closest to zero.
 */
export function measureDelay(
  recorded: { samples: Float32Array; sampleRate: number },
  source: { samples: Float32Array; sampleRate: number },
): AudioDelay {
  const rec = envelope(recorded.samples, recorded.sampleRate);
  const src = envelope(source.samples, source.sampleRate);
  const n = src.length;
  const length = Math.min(rec.length, n);
  let best: AudioDelay = { delayMs: 0, correlation: -Infinity };
  for (let delay = -Math.floor(n / 2); delay < Math.ceil(n / 2); delay++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += (rec[i] ?? 0) * (src[(((i - delay) % n) + n) % n] ?? 0);
    const correlation = sum / length;
    if (correlation > best.correlation) best = { delayMs: delay * ENVELOPE_MS, correlation };
  }
  return best;
}
