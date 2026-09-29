// Extension page (stands in for Pointcast's popup/side panel): install() needs its user gesture; the
// recognition itself runs in the offscreen document, driven by runtime messages.
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "record and recognize speech",
  });
}

globalThis.offscreen = async (cmd, opts = {}) => {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", cmd, opts });
};

// ?autoinstall: ask the offscreen document to install() at load, with no user gesture anywhere (Playwright's
// evaluate() would give the page one).
if (location.search.includes("autoinstall")) {
  globalThis.autoInstall = (async () => {
    const api = await offscreen("api");
    return { before: api["available es-ES local"], activation: api.activation, install: await offscreen("install") };
  })();
}
