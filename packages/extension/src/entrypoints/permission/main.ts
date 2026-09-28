import { browser } from "wxt/browser";
import { parseFromTab } from "../../background/permission-page";
import { permissionView, stateAfterRequest, type PermissionState } from "./view";

const allowEl = document.getElementById("allow") as HTMLButtonElement;
const stepsEl = document.getElementById("steps") as HTMLElement;
const checkEl = document.getElementById("check") as HTMLButtonElement;
const backEl = document.getElementById("back") as HTMLButtonElement;
const resultEl = document.getElementById("result") as HTMLParagraphElement;

/** The tab the user recorded from (background/permission-page.ts), for "Back to my app". */
const fromTab = parseFromTab(location.search);

function show(state: PermissionState): void {
  const view = permissionView(state);
  allowEl.hidden = !view.allow;
  stepsEl.hidden = !view.steps;
  backEl.hidden = !view.back;
  resultEl.hidden = view.result === null;
  resultEl.textContent = view.result?.text ?? "";
  resultEl.className = `result ${view.result?.tone ?? ""}`;
  // Keyboard users land on the one thing left to do.
  if (view.back) backEl.focus();
}

async function request(): Promise<void> {
  try {
    // The grant belongs to the extension origin, so the offscreen recorder can use it later.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release it right away: this page only asks for permission, it does not record.
    for (const track of stream.getTracks()) track.stop();
    show({ kind: "granted" });
  } catch (error) {
    show(stateAfterRequest(error));
  }
}

/** The grant as Chrome sees it now; undefined where the microphone permission cannot be queried. */
async function queryGrant(): Promise<PermissionStatus | undefined> {
  try {
    return await navigator.permissions.query({ name: "microphone" as PermissionName });
  } catch {
    return undefined;
  }
}

allowEl.addEventListener("click", () => void request());

// After the user changed the site settings. "prompt" means they reset it rather than allowing it:
// asking again shows Chrome's prompt, which is what they want.
checkEl.addEventListener("click", async () => {
  const status = await queryGrant();
  if (status?.state === "granted") show({ kind: "granted" });
  else if (status?.state === "prompt") await request();
  else show({ kind: "blocked", checkedAgain: true });
});

// Brings the app's tab (and its window) to the front, then closes this page: nothing is left to do here.
backEl.addEventListener("click", async () => {
  try {
    if (fromTab !== undefined) {
      const tab = await browser.tabs.update(fromTab, { active: true });
      if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    // The app's tab was closed meanwhile: closing this page is still the way back.
  }
  const self = await browser.tabs.getCurrent();
  if (self?.id !== undefined) await browser.tabs.remove(self.id);
});

// Opened again after granting (or granted in the site settings): say so instead of asking. Chrome
// also reports a change made in the site settings while this page is open.
const status = await queryGrant();
if (status) {
  const follow = () => {
    if (status.state === "granted") show({ kind: "granted" });
    else if (status.state === "denied") show({ kind: "blocked", checkedAgain: false });
    else show({ kind: "prompt" });
  };
  follow();
  status.addEventListener("change", follow);
}
