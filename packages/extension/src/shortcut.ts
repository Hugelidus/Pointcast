/**
 * The keyboard shortcuts: Record/Stop and Undo, without opening the popup. Shared by
 * the manifest (wxt.config.ts), the service worker (which handles them) and the popup (which shows
 * them), so it imports nothing from the extension APIs.
 */

/** Name of the manifest command; chrome://extensions/shortcuts lists it by its description. */
export const TOGGLE_RECORDING_COMMAND = "toggle-recording";

/**
 * Alt+Shift+S, "S" for Start/Stop (Option+Shift+S on macOS, where Chrome maps Alt to Option).
 *
 * Chrome assigns a suggested key only when it is not one of its own accelerators, and its own
 * table holds more than its help page lists. Alt+Shift+R was the first choice and is listed
 * nowhere, yet Chrome 153 on Windows refused it, as it refused Alt+Shift+P, C and X, while it
 * assigned Alt+Shift+S, E, O, Y, K, 0 and 9 (found by loading the built extension in Playwright's
 * Chromium and reading chrome.commands.getAll). dev/e2e/shortcut.spec.ts fails if a later Chrome
 * takes this key too. Chrome also requires Ctrl or Alt in a shortcut and rejects Ctrl+Alt.
 *
 * It is only a suggestion either way: Chrome leaves the command unbound when the keys are taken
 * (by Chrome or by another extension), and the user can change or remove it in
 * chrome://extensions/shortcuts. So the popup shows the binding Chrome reports, never this constant.
 */
export const SUGGESTED_TOGGLE_SHORTCUT = "Alt+Shift+S";

/** Name of the manifest command that removes the last captured gesture while recording. */
export const UNDO_EVENT_COMMAND = "undo-last-event";

/**
 * Alt+Shift+U, "U" for Undo. Alt+Shift+Z was the first choice, but Chrome 153 on Windows refused
 * it (as it refused Alt+Shift+B and W), while it assigned Alt+Shift+U, D, Q, Delete and Comma
 * next to Alt+Shift+S (checked 2026-09-27 the same way as above, with a manifest-only extension
 * in Playwright's headless Chromium). Like the other one, only a suggestion: the popup's Undo
 * button works whatever the binding.
 */
export const SUGGESTED_UNDO_SHORTCUT = "Alt+Shift+U";
