import { EventEmitter } from "node:events";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * What `wait_for_recording` waits on: a recording that arrives in the sessions folder after the
 * agent started listening. Two ways in, both always on:
 *
 * - This process's own handoff receiver calls `stored(id)` the moment it has renamed a complete
 *   recording into place (handoff/store.ts), which ends a wait at once.
 * - A poll of the folder, for every other way a recording lands there: another agent session's
 *   pointcast server holds the handoff port (only one receives, D11 "Several servers", and they
 *   all read the same folder), or the extension fell back to Chrome's downloads. Those write file
 *   by file, so such a folder is only taken once its files have stopped changing and hold a spec
 *   (session.md or words.json); reading earlier could render session.md while Chrome is still
 *   saving its own copy, which Chrome would then rename to "session (1).md".
 *
 * A poll lists the folder's names only; it looks inside a folder only when the name is new.
 * "New" means not there when the agent first called `next()` (the baseline), and not returned
 * or fetched since (`delivered`): a recording made while the agent was applying the previous one
 * is returned by the next call, not lost, and one the agent already read with get_session is not
 * returned again.
 */
export interface RecordingWatchOptions {
  /** The sessions folder (resolveSessionsBase). */
  base: string;
  /** How often the folder is listed while waiting. Default 1000 ms. */
  pollMs?: number;
  /** How long a folder written by someone else must stay unchanged before it is read. Default 1500 ms. */
  settleMs?: number;
  /** A folder that never gets a spec (a voice recording nobody processed) is returned after this long anyway. Default 30 s. */
  incompleteMs?: number;
  /** Injected in tests. */
  now?: () => number;
}

export interface NewRecording {
  id: string;
  dir: string;
  /** More new recordings after this one, for the next call. */
  waiting: number;
}

interface Seen {
  signature: string;
  /** When the signature last changed. */
  since: number;
  firstSeen: number;
}

export class RecordingWatch {
  private readonly base: string;
  private readonly pollMs: number;
  private readonly settleMs: number;
  private readonly incompleteMs: number;
  private readonly now: () => number;
  private baseline: Set<string> | undefined;
  private readonly delivered = new Set<string>();
  private readonly received = new Set<string>();
  private readonly seen = new Map<string, Seen>();
  private readonly changes = new EventEmitter();

  constructor(options: RecordingWatchOptions) {
    this.base = options.base;
    this.pollMs = options.pollMs ?? 1_000;
    this.settleMs = options.settleMs ?? 1_500;
    this.incompleteMs = options.incompleteMs ?? 30_000;
    this.now = options.now ?? Date.now;
    // Every waiting call listens; more than 10 at once is not a leak.
    this.changes.setMaxListeners(0);
  }

  /** Whether an agent has started listening: recordings from now on are new. */
  get listening(): boolean {
    return this.baseline !== undefined;
  }

  /** The handoff receiver stored this recording, complete: a wait can return it now. */
  stored(id: string): void {
    this.received.add(id);
    this.changes.emit("change");
  }

  /** The agent has this recording (get_session, or a wait returned it): never return it again. */
  markDelivered(id: string): void {
    this.delivered.add(id);
  }

  /**
   * The oldest new recording, as soon as there is one; undefined once `timeoutMs` has passed or
   * `signal` aborts. Never throws: a sessions folder that does not exist yet has no recordings.
   * With `accept`, only recordings it accepts count (wait_for_recording: this project's); the
   * others are left as they are, not delivered, so a later call without the filter still gets them.
   */
  async next(options: { timeoutMs: number; signal?: AbortSignal; accept?: (dir: string) => Promise<boolean> }): Promise<NewRecording | undefined> {
    this.baseline ??= new Set(await this.folders());
    const deadline = this.now() + options.timeoutMs;
    for (;;) {
      const found = await this.ready(options.accept);
      if (found !== undefined) {
        this.delivered.add(found.id);
        return found;
      }
      const left = deadline - this.now();
      if (left <= 0 || options.signal?.aborted) return undefined;
      await this.pause(Math.min(this.pollMs, left), options.signal);
    }
  }

  private async ready(accept: ((dir: string) => Promise<boolean>) | undefined): Promise<NewRecording | undefined> {
    const baseline = this.baseline!;
    const fresh = (await this.folders()).filter((name) => !baseline.has(name) && !this.delivered.has(name)).sort();
    // One clock reading per pass: folders that arrived together settle together.
    const now = this.now();
    const ready: string[] = [];
    for (const name of fresh) {
      if (!(await this.isReady(name, now))) continue;
      if (accept === undefined || (await accept(path.join(this.base, name)))) ready.push(name);
    }
    if (ready.length === 0) return undefined;
    return { id: ready[0]!, dir: path.join(this.base, ready[0]!), waiting: ready.length - 1 };
  }

  private async isReady(name: string, now: number): Promise<boolean> {
    if (this.received.has(name)) return true;
    const files = await readdir(path.join(this.base, name), { withFileTypes: true }).catch(() => []);
    const names = files.filter((file) => file.isFile()).map((file) => file.name);
    if (!names.includes("session.json")) return false;
    const sizes = await Promise.all(
      names.sort().map(async (file) => {
        const info = await stat(path.join(this.base, name, file)).catch(() => undefined);
        return `${file}:${info?.size ?? -1}:${info?.mtimeMs ?? -1}`;
      }),
    );
    const signature = sizes.join("|");
    const before = this.seen.get(name);
    if (before === undefined || before.signature !== signature) {
      this.seen.set(name, { signature, since: now, firstSeen: before?.firstSeen ?? now });
      return false;
    }
    if (now - before.since < this.settleMs) return false;
    const hasSpec = names.includes("session.md") || names.includes("words.json");
    return hasSpec || now - before.firstSeen >= this.incompleteMs;
  }

  /** Folder names directly under the base, without dot folders (a receiver's staging, H6). */
  private async folders(): Promise<string[]> {
    const entries = await readdir(this.base, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
  }

  /** Until `ms` pass, the receiver stores something, or `signal` aborts. Keeps no process alive. */
  private pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.changes.off("change", done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      timer.unref();
      this.changes.once("change", done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}
