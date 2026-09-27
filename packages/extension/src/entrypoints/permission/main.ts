const allowEl = document.getElementById("allow") as HTMLButtonElement;
const resultEl = document.getElementById("result") as HTMLParagraphElement;

const GRANTED_TEXT = "Microphone allowed. Go back to your app and press Record in the pointcast popup.";

function showResult(text: string, ok: boolean): void {
  resultEl.hidden = false;
  resultEl.textContent = text;
  resultEl.className = `result ${ok ? "ok" : "error"}`;
}

function showGranted(): void {
  allowEl.disabled = true;
  showResult(GRANTED_TEXT, true);
}

allowEl.addEventListener("click", async () => {
  try {
    // The grant belongs to the extension origin, so the offscreen recorder can use it later.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release it right away: this page only asks for permission, it does not record.
    for (const track of stream.getTracks()) track.stop();
    showGranted();
  } catch (error) {
    const blocked = error instanceof DOMException && error.name === "NotAllowedError";
    showResult(
      blocked
        ? "Microphone access was blocked. Click the icon at the right of the address bar (or open the site settings of this page), allow the microphone, then reload this page."
        : `Could not open the microphone: ${error instanceof Error ? error.message : String(error)}`,
      false,
    );
  }
});

// Opened again after granting (or granted in the site settings): say so instead of asking.
try {
  const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
  if (status.state === "granted") showGranted();
} catch {
  // Some browsers cannot query the microphone permission; the button still works.
}
