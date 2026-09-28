/**
 * Offscreen document of the MV3 probe: the context pointcast already uses for the recorder (D6),
 * and the natural home for in-extension transcription. It loads the spike's page logic unchanged
 * (window.spike, which runs Whisper in a module worker) and answers the service worker.
 */
import "../spike/app.js";
import { runChecks } from "./checks.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  const work = message.cmd === "checks" ? runChecks() : window.spike.run(message.config);
  work.then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String(err?.stack ?? err).slice(0, 2000) }),
  );
  return true; // answer asynchronously
});
