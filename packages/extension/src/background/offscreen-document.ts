import { browser } from "wxt/browser";

const OFFSCREEN_PATH = "/offscreen.html";

/**
 * Asks Chrome instead of remembering in a variable whether the document exists:
 * the service worker may have been restarted since it created it (D6).
 */
export async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  await browser.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    // USER_MEDIA: the document exists to hold a getUserMedia stream. Chrome does not
    // auto-close documents with this reason, unlike AUDIO_PLAYBACK after 30 s of silence.
    // WORKERS: after Stop it runs Whisper in a worker; CLIPBOARD: it copies the Markdown.
    reasons: ["USER_MEDIA", "WORKERS", "CLIPBOARD"],
    justification: "Record the microphone, transcribe it locally and copy the resulting Markdown.",
  });
}

/** Closing the document also frees the microphone and the blob URLs it created. */
export async function closeOffscreenDocument(): Promise<void> {
  if (!(await hasOffscreenDocument())) return;
  try {
    await browser.offscreen.closeDocument();
  } catch (error) {
    // Two download completions can race to close it; the second call finds nothing to close.
    if (await hasOffscreenDocument()) throw error;
  }
}
