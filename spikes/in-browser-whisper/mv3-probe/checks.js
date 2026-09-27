/**
 * Capability checks run inside an extension page or the offscreen document (MV3 probe).
 * Each check reports "ok"/a value or the error it hit, never throws: the point is to see what the
 * extension context allows (CSP, cross-origin isolation, workers, WebGPU, Cache API, quota).
 */
async function attempt(fn, ms = 10_000) {
  try {
    return await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms} ms`)), ms))]);
  } catch (err) {
    return `ERROR: ${String(err?.message ?? err).slice(0, 200)}`;
  }
}

function workerEcho(url, options) {
  return new Promise((resolve, reject) => {
    const w = new Worker(url, options);
    w.onmessage = ({ data }) => {
      resolve(data);
      w.terminate();
    };
    w.onerror = (e) => {
      reject(new Error(e.message || "worker failed to start (blocked or 404)"));
      w.terminate();
    };
  });
}

/** Smallest valid wasm module: magic + version. */
const EMPTY_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

export async function runChecks() {
  return {
    href: location.href,
    crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    wasmCompile: await attempt(async () => (await WebAssembly.compile(EMPTY_WASM), "ok")),
    wasmSharedMemory: await attempt(async () => (new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }), "ok")),
    moduleWorkerFromExtensionUrl: await attempt(() => workerEcho(new URL("./echo-worker.js", import.meta.url), { type: "module" })),
    blobWorker: await attempt(() =>
      workerEcho(URL.createObjectURL(new Blob(['postMessage("blob worker ran")'], { type: "text/javascript" }))),
    ),
    blobImport: await attempt(async () => {
      const url = URL.createObjectURL(new Blob(["export default 'blob import ran'"], { type: "text/javascript" }));
      return (await import(url)).default;
    }),
    cacheApiWithHttpsKey: await attempt(async () => {
      const cache = await caches.open("pcws-probe");
      await cache.put("https://huggingface.co/pcws-probe", new Response("x"));
      const text = await (await cache.match("https://huggingface.co/pcws-probe")).text();
      await caches.delete("pcws-probe");
      return text === "x" ? "ok" : "mismatch";
    }),
    storageEstimate: await attempt(async () => {
      const e = await navigator.storage.estimate();
      return { quotaGB: Number((e.quota / 2 ** 30).toFixed(1)), usageMB: Number((e.usage / 2 ** 20).toFixed(1)) };
    }),
    storagePersisted: await attempt(() => navigator.storage.persisted()),
    fetchHuggingFace: await attempt(async () => {
      const r = await fetch("https://huggingface.co/Xenova/whisper-tiny/resolve/main/preprocessor_config.json");
      return `${r.status} ${r.type}`;
    }),
    webgpu: await attempt(async () => {
      if (!("gpu" in navigator)) return "navigator.gpu missing";
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return "requestAdapter() returned null";
      const device = await adapter.requestDevice();
      device.destroy();
      return { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, isFallbackAdapter: adapter.info?.isFallbackAdapter ?? null };
    }),
    webgpuInDedicatedWorker: await attempt(() => workerEcho(new URL("./gpu-worker.js", import.meta.url), { type: "module" })),
  };
}
