/** Whisper's input rate. The engine takes 16 kHz mono samples (session-format.md). */
export const SAMPLE_RATE = 16000;

/**
 * How many windows transformers.js 4.3 will transcribe for `sampleCount` samples, so a progress
 * bar can show "chunk 3 of 6". Mirrors the loop in the library's `_call_whisper`: windows of
 * `chunkLengthS`, each starting `chunkLengthS - 2 * stride` after the previous one, until one
 * reaches the end. `chunkLengthS` 0 means no chunking: one window.
 */
export function countChunks(sampleCount: number, chunkLengthS: number, strideLengthS?: number): number {
  if (chunkLengthS <= 0) return 1;
  const window = SAMPLE_RATE * chunkLengthS;
  const jump = window - 2 * SAMPLE_RATE * (strideLengthS ?? chunkLengthS / 6);
  let count = 1;
  for (let offset = 0; offset + window < sampleCount; offset += jump) count++;
  return count;
}
