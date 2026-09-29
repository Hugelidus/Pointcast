// Offscreen document (reasons USER_MEDIA + AUDIO_PLAYBACK, like Pointcast's recorder).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return false;
  const run = async () => {
    if (msg.cmd === "api") return { ...(await probe.api()), activation: navigator.userActivation?.isActive ?? null };
    if (msg.cmd === "install") return probe.install(); // no user activation here: expected to fail if downloadable
    if (msg.cmd === "recognize") return probe.recognize(msg.opts);
    throw new Error(`unknown cmd ${msg.cmd}`);
  };
  run().then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});
