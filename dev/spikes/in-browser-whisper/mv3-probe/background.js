/**
 * Service worker of the MV3 probe. probe-mv3.mjs calls these globals through Playwright.
 * Same offscreen setup as pointcast (reason USER_MEDIA), plus WORKERS since the job runs a worker.
 */
const OFFSCREEN_URL = "mv3-probe/offscreen.html?nocache=1";

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA", "WORKERS"],
    justification: "Record the microphone and transcribe it locally.",
  });
}

self.probeOffscreen = async (cmd, config) => {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", cmd, config });
};

/** What the service worker itself offers (the HF browser-extension example runs models here). */
self.serviceWorkerChecks = async () => {
  let webgpu = "navigator.gpu missing";
  if ("gpu" in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      webgpu = adapter ? { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture } : "no adapter";
    } catch (err) {
      webgpu = `ERROR: ${err}`;
    }
  }
  let wasmCompile = "ok";
  try {
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  } catch (err) {
    wasmCompile = `ERROR: ${err.message}`;
  }
  return {
    crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    workerConstructor: typeof Worker,
    wasmCompile,
    webgpu,
    manifestName: chrome.runtime.getManifest().name,
  };
};
