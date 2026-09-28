// Does a dedicated worker started by an extension context get WebGPU with a real adapter?
const adapter = "gpu" in navigator ? await navigator.gpu.requestAdapter() : null;
postMessage(adapter ? `adapter ${adapter.info?.vendor} ${adapter.info?.architecture}` : "gpu" in navigator ? "no adapter" : "navigator.gpu missing");
