import type { CommandResult } from "../messages";

/**
 * Builds the chrome.commands.onCommand handler from one handler per command name (Record/Stop
 * runs commands.ts toggleRecording, the same command as the popup's button; Undo runs
 * undoLastEvent, like the popup's Undo button). Unknown commands are ignored.
 *
 * A press that arrives while the previous press of the same command is still being handled is
 * ignored, as the popup disables its button while a command runs. Holding the keys or pressing
 * twice must not send two starts that both read "idle" before either writes "starting": the
 * second would find the recorder busy and close the offscreen document under the first. For
 * Undo it means key repeat cannot remove several gestures at once. The flags belong to this
 * service worker instance only, like `recovered` in background.ts: when Chrome stops the worker,
 * the command it was running is gone as well, and recoverInterruptedTransition repairs the
 * state the new instance finds (D6).
 */
export function createShortcutHandler(
  handlers: Record<string, () => Promise<CommandResult>>,
): (command: string) => Promise<CommandResult | undefined> {
  const running = new Set<string>();
  return async (command) => {
    const handle = Object.hasOwn(handlers, command) ? handlers[command] : undefined;
    if (!handle || running.has(command)) return undefined;
    running.add(command);
    try {
      // A refused command ("Cannot start while stopping.") changes nothing. Failures the user
      // must see (no microphone, recorder errors) are stored in the state and shown by the popup.
      return await handle();
    } catch (error) {
      console.error(`[pointcast] the keyboard shortcut "${command}" failed`, error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      running.delete(command);
    }
  };
}
