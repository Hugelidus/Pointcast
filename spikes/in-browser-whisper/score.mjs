/**
 * Scoring shared by the page (browser) and the Node scripts of this spike.
 *
 * A plain-JS port of the scoring in scripts/bench/transcribe.ts (normalize, alignWords,
 * percentile, the es-short "esto" check) and of packages/cli/src/transcribe/monotonic.ts
 * (dropReemittedWords), so browser numbers are comparable with scripts/bench/results.json.
 * Ported rather than imported: the page cannot import TypeScript, and this spike must not
 * change product code. Keep it byte-for-byte equivalent in behaviour.
 */

/** Same as core's normalizeWord: lowercase, strip accents and punctuation. */
export function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** packages/cli/src/transcribe/monotonic.ts, verbatim logic. Words: {text, start, end} in ms. */
export function dropReemittedWords(words) {
  const kept = [];
  let skipping = false;
  for (const word of words) {
    const last = kept.at(-1);
    if (last !== undefined) {
      if (word.start < last.start) skipping = true;
      if (skipping && word.start < last.end) continue;
    }
    skipping = false;
    kept.push(word);
  }
  return kept;
}

/** Pipeline chunks ({text, timestamp:[s, s|null]}) to words in ms, like local.ts does. */
export function chunksToWords(chunks) {
  return dropReemittedWords(
    (chunks ?? []).map((chunk) => ({
      text: chunk.text,
      start: Math.round(chunk.timestamp[0] * 1000),
      end: Math.round((chunk.timestamp[1] ?? chunk.timestamp[0]) * 1000),
    })),
  );
}

function betterOrEqual(a, b) {
  if (a.count !== b.count) return a.count > b.count;
  return a.cost <= b.cost;
}

/** LCS with a time-cost tie-break; see alignWords in scripts/bench/transcribe.ts for why. */
export function alignWords(hyp, ref) {
  const n = hyp.length;
  const m = ref.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1));
  for (let i = 0; i <= n; i++) dp[i][0] = { count: 0, cost: 0 };
  for (let j = 0; j <= m; j++) dp[0][j] = { count: 0, cost: 0 };

  const matchCandidate = (i, j) => ({
    count: dp[i - 1][j - 1].count + 1,
    cost: dp[i - 1][j - 1].cost + Math.abs(hyp[i - 1].start - ref[j - 1].start),
  });

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const up = dp[i - 1][j];
      const left = dp[i][j - 1];
      let best = betterOrEqual(up, left) ? up : left;
      if (hyp[i - 1].text === ref[j - 1].text) {
        const candidate = matchCandidate(i, j);
        if (betterOrEqual(candidate, best)) best = candidate;
      }
      dp[i][j] = best;
    }
  }

  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const cur = dp[i][j];
    if (hyp[i - 1].text === ref[j - 1].text) {
      const candidate = matchCandidate(i, j);
      if (candidate.count === cur.count && candidate.cost === cur.cost) {
        pairs.push([i - 1, j - 1]);
        i--;
        j--;
        continue;
      }
    }
    const up = dp[i - 1][j];
    if (up.count === cur.count && up.cost === cur.cost) i--;
    else j--;
  }
  pairs.reverse();
  return { matches: dp[n][m].count, pairs };
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * Scores engine words ({text, start}) against SAPI ground truth ({words:[{text, startMs}]}),
 * exactly as benchOneAudio in scripts/bench/transcribe.ts does.
 */
export function scoreWords(words, ground) {
  const hyp = words.map((w) => ({ text: normalize(w.text), start: w.start })).filter((w) => w.text !== "");
  const ref = ground.words.map((w) => ({ text: normalize(w.text), start: w.startMs })).filter((w) => w.text !== "");
  const { matches, pairs } = alignWords(hyp, ref);
  const errors = pairs.map(([hi, ri]) => Math.abs(hyp[hi].start - ref[ri].start)).sort((a, b) => a - b);
  return {
    wordAccuracy: ref.length === 0 ? 1 : matches / ref.length,
    medianStartErrorMs: percentile(errors, 50),
    p90StartErrorMs: percentile(errors, 90),
    hypWords: hyp.length,
    refWords: ref.length,
  };
}

/** checkEstoDeictics from scripts/bench/transcribe.ts: each ground-truth "esto" found within 1200 ms? */
export function estoCheck(words, ground) {
  const refEstos = ground.words.filter((w) => normalize(w.text) === "esto");
  const hypEstos = words.filter((w) => normalize(w.text) === "esto");
  return refEstos
    .map((ref) => {
      const nearest = hypEstos.map((h) => ({ h, err: Math.abs(h.start - ref.startMs) })).sort((a, b) => a.err - b.err)[0];
      if (!nearest) return `MISSING esto@${ref.startMs}ms`;
      return `esto@${ref.startMs}ms -> ${nearest.h.start}ms (err ${nearest.err}ms) ${nearest.err <= 1200 ? "OK" : "IMPLAUSIBLE"}`;
    })
    .join("; ");
}

/** Minimal PCM16 mono 16 kHz WAV reader (same contract as packages/cli/src/audio/wav.ts). */
export function readWavPcm16Mono16k(bytes) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const ascii = (o, n) => String.fromCharCode(...buffer.subarray(o, o + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let pos = 12;
  let fmt = -1;
  let data = -1;
  let dataSize = 0;
  while (pos + 8 <= buffer.length) {
    const id = ascii(pos, 4);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") fmt = pos + 8;
    else if (id === "data") {
      data = pos + 8;
      dataSize = size;
    }
    pos = pos + 8 + size + (size % 2);
  }
  if (fmt < 0 || data < 0) throw new Error("WAV without fmt/data chunk");
  const format = view.getUint16(fmt, true);
  const channels = view.getUint16(fmt + 2, true);
  const rate = view.getUint32(fmt + 4, true);
  const bits = view.getUint16(fmt + 14, true);
  if (format !== 1 || channels !== 1 || rate !== 16000 || bits !== 16) {
    throw new Error(`expected PCM16 mono 16 kHz, got format ${format}, ${channels} ch, ${rate} Hz, ${bits} bit`);
  }
  const count = (Math.min(dataSize, buffer.length - data) & ~1) / 2;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = view.getInt16(data + i * 2, true);
    samples[i] = v < 0 ? v / 32768 : v / 32767;
  }
  return samples;
}
