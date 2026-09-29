// Runs in a normal page and in the extension's offscreen document. Exposes globalThis.probe.
const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

async function api() {
  const out = {
    ua: navigator.userAgent,
    hasSpeechRecognition: typeof globalThis.SpeechRecognition,
    hasWebkit: typeof globalThis.webkitSpeechRecognition,
    staticKeys: SR ? Object.getOwnPropertyNames(SR) : null,
    protoKeys: SR ? Object.getOwnPropertyNames(SR.prototype) : null,
    startLength: SR ? SR.prototype.start.length : null,
    userActivation: navigator.userActivation?.isActive,
  };
  for (const [name, opts] of [
    ["es-ES local", { langs: ["es-ES"], processLocally: true }],
    ["es local", { langs: ["es"], processLocally: true }],
    ["en-US local", { langs: ["en-US"], processLocally: true }],
    ["es-ES cloud", { langs: ["es-ES"], processLocally: false }],
  ]) {
    try {
      out[`available ${name}`] = await SR.available(opts);
    } catch (e) {
      out[`available ${name}`] = `THROW ${e.name}: ${e.message}`;
    }
  }
  return out;
}

async function install(langs = ["es-ES"]) {
  const t0 = performance.now();
  try {
    const r = await SR.install({ langs, processLocally: true });
    return { result: r, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { error: `${e.name}: ${e.message}`, ms: Math.round(performance.now() - t0) };
  }
}

/**
 * Recognizes until `untilMs`. source: "mic" (default input, start()) or "track" (getUserMedia track passed to
 * start(track)). Every event is logged with its arrival time (performance.now()) and event.timeStamp, both
 * relative to t0 = just before start(). With restart, a new session starts whenever one ends.
 */
function recognize({ lang = "es-ES", source = "mic", untilMs = 170000, restart = true, interim = true, local = true, continuous = true } = {}) {
  return new Promise(async (resolve) => {
    const log = [];
    let track = null;
    let t0 = performance.now();
    let ac = null;
    if (source === "track") {
      // Fake mic (Chrome plays the WAV from when the device opens); t0 = now, so times carry an unknown offset:
      // the runner calibrates it from the level onset logged below.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      track = stream.getAudioTracks()[0];
      t0 = performance.now();
      ac = new AudioContext();
      ac.createMediaStreamSource(stream).connect(onsetDetector(ac, () => log.push({ t: Math.round(performance.now() - t0), type: "onset" })));
    } else if (source.startsWith("file:")) {
      // The WAV decoded and played into a MediaStreamAudioDestinationNode (never to the speakers). t0 is the
      // scheduled start of the file on the audio clock, mapped to performance.now(): times are file times.
      ac = new AudioContext();
      const bytes = await (await fetch(`/audio/${source.slice(5)}`)).arrayBuffer();
      const buffer = await ac.decodeAudioData(bytes);
      const node = new AudioBufferSourceNode(ac, { buffer });
      const dest = ac.createMediaStreamDestination();
      node.connect(dest);
      track = dest.stream.getAudioTracks()[0];
      await ac.resume();
      const when = ac.currentTime + 0.3;
      const ts = ac.getOutputTimestamp();
      t0 = ts.performanceTime + (when - ts.contextTime) * 1000;
      node.start(when);
      const s2 = ac.createMediaStreamSource(dest.stream);
      s2.connect(onsetDetector(ac, () => log.push({ t: Math.round(performance.now() - t0), type: "onset" })));
    }
    const now = () => Math.round(performance.now() - t0);
    if (track) log.push({ t: now(), type: "track", label: track.label, settings: track.getSettings() });
    let sessions = 0;
    let finished = false;
    const done = (extra = {}) => {
      if (finished) return;
      finished = true;
      resolve({ log, sessions, ...extra });
    };
    const startOne = () => {
      const r = new SR();
      r.lang = lang;
      r.continuous = continuous;
      r.interimResults = interim;
      r.maxAlternatives = 1;
      if (local) r.processLocally = true;
      const session = ++sessions;
      for (const type of ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "nomatch"]) {
        r.addEventListener(type, (e) => log.push({ t: now(), ts: Math.round(e.timeStamp - t0), type, session }));
      }
      r.onresult = (e) => {
        const results = [];
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const alt = e.results[i][0];
          results.push({ i, final: e.results[i].isFinal, text: alt.transcript, conf: alt.confidence });
        }
        log.push({ t: now(), ts: Math.round(e.timeStamp - t0), type: "result", session, resultIndex: e.resultIndex, length: e.results.length, results });
      };
      r.onerror = (e) => log.push({ t: now(), type: "error", session, error: e.error, message: e.message });
      r.onend = () => {
        log.push({ t: now(), type: "end", session });
        if (!finished && restart && now() < untilMs) startOne();
        else done();
      };
      try {
        if (track) r.start(track);
        else r.start();
        log.push({ t: now(), type: "started", session });
      } catch (e) {
        log.push({ t: now(), type: "startThrow", session, error: `${e.name}: ${e.message}` });
        done();
      }
      globalThis.__rec = r;
    };
    startOne();
    setTimeout(() => {
      if (finished) return;
      restart = false;
      log.push({ t: now(), type: "stopCalled" });
      try {
        globalThis.__rec.stop();
      } catch {}
      setTimeout(() => done({ timedOut: true }), 5000);
    }, untilMs);
  });
}

/** An analyser polled every 10 ms that calls onOnset once, the first time the level passes -45 dBFS. */
function onsetDetector(ac, onOnset) {
  const an = ac.createAnalyser();
  an.fftSize = 512;
  const buf = new Float32Array(512);
  const timer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    if (20 * Math.log10(rms + 1e-9) > -45) {
      clearInterval(timer);
      onOnset();
    }
  }, 10);
  return an;
}

globalThis.probe = { api, install, recognize };

// ?autoinstall: call install() at load, with no user activation (Playwright's evaluate() runs with a user
// gesture, so it cannot test this).
if (globalThis.location?.search.includes("autoinstall")) {
  const activation = navigator.userActivation?.isActive ?? null;
  const before = SR.available({ langs: ["es-ES"], processLocally: true });
  globalThis.autoInstall = before.then(async (b) => ({ activation, before: b, install: await install(), after: await SR.available({ langs: ["es-ES"], processLocally: true }) }));
}
globalThis.probeReady = true;
