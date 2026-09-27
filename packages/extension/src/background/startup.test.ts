import { describe, expect, it, vi } from "vitest";
import { TOGGLE_RECORDING_COMMAND } from "../shortcut";

/**
 * The service worker entrypoint's wiring. Chrome delivers the event that woke a stopped worker
 * only to listeners added in its first turn (D6), so this checks what is registered before any
 * await, with every dependency replaced by a stand-in.
 */
const fake = vi.hoisted(() => {
  const listeners = {
    command: [] as ((command: string) => void)[],
    installed: [] as (() => void)[],
    startup: [] as (() => void)[],
    downloads: [] as ((delta: object) => void)[],
    alarms: [] as ((alarm: { name: string }) => void)[],
    permissions: [] as (() => void)[],
  };
  return {
    listeners,
    finishRecovery: undefined as (() => void) | undefined,
    toggleRecording: vi.fn(async () => ({ ok: true }) as const),
    listenFor: vi.fn(),
    clearLastMarkdown: vi.fn(async () => undefined),
  };
});

vi.mock("wxt/utils/define-background", () => ({ defineBackground: (main: () => void) => ({ main }) }));
vi.mock("wxt/browser", () => ({
  browser: {
    storage: { session: { setAccessLevel: async () => undefined } },
    runtime: {
      onInstalled: { addListener: (l: () => void) => fake.listeners.installed.push(l) },
      onStartup: { addListener: (l: () => void) => fake.listeners.startup.push(l) },
    },
    downloads: { onChanged: { addListener: (l: (delta: object) => void) => fake.listeners.downloads.push(l) } },
    commands: { onCommand: { addListener: (l: (command: string) => void) => fake.listeners.command.push(l) } },
    alarms: { onAlarm: { addListener: (l: (alarm: { name: string }) => void) => fake.listeners.alarms.push(l) } },
    permissions: {
      onAdded: { addListener: (l: () => void) => fake.listeners.permissions.push(l) },
      onRemoved: { addListener: (l: () => void) => fake.listeners.permissions.push(l) },
    },
  },
}));
vi.mock("../messages", () => ({ listenFor: fake.listenFor }));
vi.mock("../state-store", () => ({ readState: async () => ({ status: "idle" }), clearLastMarkdown: fake.clearLastMarkdown }));
vi.mock("./site-scripts", () => ({ syncRegisteredSiteScripts: async () => undefined }));
vi.mock("./content-scripts", () => ({ attachToOpenTabs: async () => [], attachToTab: async () => ({ status: "attached" }) }));
vi.mock("./commands", () => ({
  recoverInterruptedTransition: () => new Promise<void>((resolve) => (fake.finishRecovery = resolve)),
  toggleRecording: fake.toggleRecording,
  finishSessionIfSaved: async () => undefined,
  finishProcessing: async () => ({ ok: true }),
  recordProcessingProgress: async () => undefined,
  abandonOverdueProcessing: async () => undefined,
  PROCESSING_ALARM: "pointcast-processing-timeout",
  recordEventCount: async () => undefined,
  startRecording: async () => ({ ok: true }),
  stopRecording: async () => ({ ok: true }),
  undoLastEvent: async () => ({ ok: false, error: "Nothing to undo." }),
}));

const background = (await import("../entrypoints/background")).default as unknown as { main: () => void };

describe("service worker startup", () => {
  it("registers every listener synchronously, and handles the shortcut once the state is recovered", async () => {
    background.main();
    // Checked before any await: these were added in the worker's first turn.
    expect(fake.listenFor).toHaveBeenCalledWith("background", expect.any(Function));
    expect(fake.listeners.command).toHaveLength(1);
    expect(fake.listeners.installed).toHaveLength(1);
    expect(fake.listeners.startup).toHaveLength(1);
    expect(fake.listeners.downloads).toHaveLength(1);
    expect(fake.listeners.alarms).toHaveLength(1);
    // Enabling or removing a site (optional host permissions) re-registers its content scripts.
    expect(fake.listeners.permissions).toHaveLength(2);

    // The worker was woken by the shortcut while an interrupted transition is being repaired:
    // the toggle waits for the repair, as popup commands do.
    fake.listeners.command[0]?.(TOGGLE_RECORDING_COMMAND);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.toggleRecording).not.toHaveBeenCalled();
    fake.finishRecovery?.();
    await vi.waitFor(() => expect(fake.toggleRecording).toHaveBeenCalledTimes(1));
  });

  it("forgets the last Markdown when the browser starts, like storage.session does", () => {
    fake.listeners.startup[0]?.();
    expect(fake.clearLastMarkdown).toHaveBeenCalledTimes(1);
  });
});
