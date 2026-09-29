// Sanity check of the fake microphone: level (dBFS) per 500 ms of the getUserMedia track for 16 s.
//   node check-fake-mic.mjs [wav]
import { chromium, CHROME, PROFILE, serve, fakeAudioArgs } from "./lib.mjs";

const wav = process.argv[2] ?? "es-short.wav";
const { server, origin } = await serve();
const ctx = await chromium.launchPersistentContext(PROFILE, { executablePath: CHROME, headless: true, args: fakeAudioArgs(wav) });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(origin + "/");
const out = await page.evaluate(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ac = new AudioContext();
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 2048;
  src.connect(an);
  const buf = new Float32Array(2048);
  const levels = [];
  for (let i = 0; i < 32; i++) {
    await new Promise((r) => setTimeout(r, 500));
    an.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    levels.push(Math.round(20 * Math.log10(rms + 1e-9)));
  }
  return { sampleRate: ac.sampleRate, settings: stream.getAudioTracks()[0].getSettings(), levels };
});
console.log(JSON.stringify(out));
await ctx.close();
server.close();
