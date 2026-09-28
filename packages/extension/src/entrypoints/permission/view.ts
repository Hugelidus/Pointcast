/**
 * What the permission page shows for each state of the microphone grant. Pure, so every state
 * is tested without a browser; main.ts only applies it to the DOM.
 */

export type PermissionState =
  /** Not decided yet: the button asks Chrome, which shows its prompt. */
  | { kind: "prompt" }
  | { kind: "granted" }
  /** The user (or a policy) blocked it: Chrome no longer prompts, so the page explains how to undo it. */
  | { kind: "blocked"; checkedAgain: boolean }
  | { kind: "error"; message: string };

export interface PermissionView {
  allow: boolean;
  /** The numbered steps to unblock the microphone in Chrome's site settings, with "Check again". */
  steps: boolean;
  /** "Back to my app": once allowed, nothing else is left to do on this page. */
  back: boolean;
  result: { text: string; tone: "ok" | "error" } | null;
}

export const GRANTED_TEXT = "Microphone allowed. Go back to your app and press Record in the Pointcast popup.";

export function permissionView(state: PermissionState): PermissionView {
  switch (state.kind) {
    case "prompt":
      return { allow: true, steps: false, back: false, result: null };
    case "granted":
      return { allow: false, steps: false, back: true, result: { text: GRANTED_TEXT, tone: "ok" } };
    case "blocked":
      return {
        allow: false,
        steps: true,
        back: false,
        result: {
          // After "Check again" the steps are already on screen: say only that nothing changed.
          text: state.checkedAgain
            ? "The microphone is still blocked. Follow the steps below, then check again."
            : "Chrome blocked the microphone for Pointcast. To allow it:",
          tone: "error",
        },
      };
    case "error":
      return { allow: true, steps: false, back: false, result: { text: `Could not open the microphone: ${state.message}`, tone: "error" } };
  }
}

/** getUserMedia's rejection as a page state: NotAllowedError is a block, anything else an error. */
export function stateAfterRequest(error: unknown): PermissionState {
  if (error instanceof DOMException && error.name === "NotAllowedError") return { kind: "blocked", checkedAgain: false };
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return { kind: "error", message: "no microphone was found. Connect one and try again." };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "error", message: /[.!?]$/.test(message) ? message : `${message}.` };
}
