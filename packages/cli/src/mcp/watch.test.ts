import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { SessionFile } from "@pointcast/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectWith, sessionWithChain, SOURCES, TOOLBAR } from "../resolve/test-support";
import { createServer, defaultWaitSeconds, LONG_WAIT_SECONDS, SHORT_WAIT_SECONDS } from "./server";
import { connectClient } from "./test-transport";
import { RecordingWatch } from "./watch";

const FIXTURE = join(__dirname, "../../../../dev/fixtures/sessions/e2e-es-v2");
const OLD = "2026-09-26_20-29-01";
const NEW = "2026-09-29_10-00-00";
const NEWER = "2026-09-29_10-05-00";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Short timings, so a folder written by "someone else" is taken within a test's patience. */
const FAST = { pollMs: 20, settleMs: 60, incompleteMs: 400 };

describe("RecordingWatch", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-watch-"));
    cpSync(FIXTURE, join(base, OLD), { recursive: true });
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  /** A recording as another agent session's server stores it: renamed into place, complete. */
  const arrive = (id: string) => cpSync(FIXTURE, join(base, id), { recursive: true });

  it("returns nothing that was there when the agent started listening", async () => {
    const watch = new RecordingWatch({ base, ...FAST });
    expect(await watch.next({ timeoutMs: 150 })).toBeUndefined();
    expect(watch.listening).toBe(true);
  });

  it("sees a recording another server stored, once its files have settled", async () => {
    const watch = new RecordingWatch({ base, ...FAST });
    const waiting = watch.next({ timeoutMs: 5_000 });
    await sleep(50);
    arrive(NEW);
    expect(await waiting).toEqual({ id: NEW, dir: join(base, NEW), waiting: 0 });
  });

  it("does not lose a recording made while the agent was busy, and never returns one twice", async () => {
    const watch = new RecordingWatch({ base, ...FAST });
    expect(await watch.next({ timeoutMs: 50 })).toBeUndefined();
    arrive(NEW);
    arrive(NEWER);
    // Oldest first, with a count of the rest.
    expect(await watch.next({ timeoutMs: 5_000 })).toMatchObject({ id: NEW, waiting: 1 });
    expect(await watch.next({ timeoutMs: 5_000 })).toMatchObject({ id: NEWER, waiting: 0 });
    expect(await watch.next({ timeoutMs: 150 })).toBeUndefined();
  });

  it("skips one the agent already fetched with get_session", async () => {
    const watch = new RecordingWatch({ base, ...FAST });
    expect(await watch.next({ timeoutMs: 50 })).toBeUndefined();
    arrive(NEW);
    watch.markDelivered(NEW);
    expect(await watch.next({ timeoutMs: 200 })).toBeUndefined();
  });

  it("waits for Chrome's downloads to finish: session.json alone is not a recording yet", async () => {
    const watch = new RecordingWatch({ base, pollMs: 20, settleMs: 60, incompleteMs: 60_000 });
    const waiting = watch.next({ timeoutMs: 5_000 });
    await sleep(50);
    mkdirSync(join(base, NEW));
    cpSync(join(FIXTURE, "session.json"), join(base, NEW, "session.json"));
    const early = await Promise.race([waiting, sleep(300).then(() => "still waiting" as const)]);
    expect(early).toBe("still waiting");
    cpSync(join(FIXTURE, "words.json"), join(base, NEW, "words.json"));
    expect(await waiting).toMatchObject({ id: NEW });
  });

  it("returns a folder with no spec in the end (get_session then says to process it), never a dot folder", async () => {
    const watch = new RecordingWatch({ base, ...FAST });
    const waiting = watch.next({ timeoutMs: 5_000 });
    await sleep(50);
    mkdirSync(join(base, ".incoming-abc"));
    writeFileSync(join(base, ".incoming-abc", "session.json"), "{}");
    mkdirSync(join(base, NEW));
    cpSync(join(FIXTURE, "session.json"), join(base, NEW, "session.json"));
    expect(await waiting).toMatchObject({ id: NEW });
  });

  it("ends at once when the receiver stores one, without waiting for a poll", async () => {
    const watch = new RecordingWatch({ base, pollMs: 60_000 });
    const started = Date.now();
    const waiting = watch.next({ timeoutMs: 30_000 });
    await sleep(50);
    arrive(NEW);
    watch.stored(NEW);
    expect(await waiting).toMatchObject({ id: NEW });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("stops when the call is cancelled, and works when the sessions folder does not exist yet", async () => {
    const watch = new RecordingWatch({ base: join(base, "not-yet"), pollMs: 60_000 });
    const abort = new AbortController();
    const waiting = watch.next({ timeoutMs: 30_000, signal: abort.signal });
    await sleep(50);
    abort.abort();
    expect(await waiting).toBeUndefined();
  });
});

describe("wait_for_recording", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-wait-tool-"));
    cpSync(FIXTURE, join(base, OLD), { recursive: true });
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("waits as long as the client allows a tool call by default", () => {
    expect(defaultWaitSeconds("claude-code")).toBe(LONG_WAIT_SECONDS);
    expect(defaultWaitSeconds("gemini-cli-mcp-client")).toBe(LONG_WAIT_SECONDS);
    expect(defaultWaitSeconds("codex-mcp-client")).toBe(SHORT_WAIT_SECONDS);
    expect(defaultWaitSeconds(undefined)).toBe(SHORT_WAIT_SECONDS);
    expect(LONG_WAIT_SECONDS).toBeLessThan(600); // Gemini CLI's 10-minute default
    expect(SHORT_WAIT_SECONDS).toBeLessThan(60); // Codex's tool_timeout_sec default
  });

  it("tells agents how to use it, and refuses a wait past 25 minutes", async () => {
    const server = createServer({ dirFlag: base, repoRoot: base, watch: new RecordingWatch({ base, ...FAST }) });
    const client = await connectClient(server);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "wait_for_recording")!;
    expect(tool.description).toMatch(/^Wait for the user's next pointcast recording and return its spec\. Use when the user asks you to listen\/watch for recordings; after applying one, call it again to keep listening\./);
    expect(tool.annotations?.readOnlyHint).toBe(true);
    const tooLong = await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 1501 } });
    expect(tooLong.isError).toBe(true);
    await client.close();
    await server.close();
  });

  it("sends progress while waiting when the client asks for it, then returns the recording like get_session", async () => {
    const watch = new RecordingWatch({ base, ...FAST });
    const server = createServer({ dirFlag: base, repoRoot: base, watch, progressEveryMs: 30 });
    const client = await connectClient(server);
    const progress: number[] = [];
    const waiting = client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 60 } }, undefined, {
      onprogress: (p) => progress.push(p.progress),
      resetTimeoutOnProgress: true,
    });
    await sleep(200);
    arrive(NEW);
    const result = await waiting;
    const body = (result.content as Array<{ text: string }>)[0]!.text;
    // The folder is NEW; the fixture's session.json keeps its own id, which the title shows.
    expect(body.split("\n").slice(0, 5)).toEqual([`New recording ${NEW}.`, "", "# 2026-09-26_20-29-01", "", "2 requests · 10 elements · ~470 tokens"]);
    // Seconds waited, strictly increasing as MCP requires.
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((seconds, i) => seconds > 0 && seconds < 60 && (i === 0 || seconds > progress[i - 1]!))).toBe(true);

    // A recording the agent read with get_session is not "new" for the next wait.
    arrive(NEWER);
    await client.callTool({ name: "get_session", arguments: { id: NEWER } });
    const next = await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 1 } });
    expect((next.content as Array<{ text: string }>)[0]!.text).toMatch(/^No new recording yet/);
    await client.close();
    await server.close();

    function arrive(id: string) {
      cpSync(FIXTURE, join(base, id), { recursive: true });
    }
  });
});

describe("wait_for_recording returns this project's recordings by default", () => {
  let base: string;
  let repo: string;

  /** The chain session, its files pointing at `file` (in SOURCES, or nowhere). */
  function arriveWithChain(id: string, file: string) {
    const dir = sessionWithChain();
    const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as SessionFile;
    session.events.find((e) => e.id === "e2")!.element.renderedBy = [{ file, line: 3 }];
    writeFileSync(join(dir, "session.json"), JSON.stringify(session));
    renameSync(dir, join(base, id));
  }
  const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) => (result.content as Array<{ text: string }>)[0]!.text;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pointcast-wait-project-"));
    cpSync(FIXTURE, join(base, OLD), { recursive: true });
    repo = projectWith(SOURCES);
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("skips another project's recording without consuming it; anyProject gets it", async () => {
    const server = createServer({ dirFlag: base, repoRoot: repo, watch: new RecordingWatch({ base, ...FAST }) });
    const client = await connectClient(server);
    // Start listening, then another project's recording arrives, then this project's.
    expect(textOf(await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 1 } }))).toMatch(/^No new recording yet/);
    arriveWithChain(NEW, "src/Elsewhere.tsx");
    arriveWithChain(NEWER, TOOLBAR);

    const here = textOf(await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 10 } }));
    expect(here.split("\n")[0]).toBe(`New recording ${NEWER}.`);
    expect(here).not.toContain("**Warning:**");
    expect(textOf(await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 1 } }))).toMatch(/^No new recording yet/);

    // Still new: a session on the right project (or anyProject here) gets it, with the warning.
    const any = textOf(await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 10, anyProject: true } }));
    expect(any.split("\n")[0]).toBe(`New recording ${NEW}.`);
    expect(any).toContain("**Warning:**");
    await client.close();
    await server.close();
  });

  it("keeps a recording that names no files, and says a wrong project folder", async () => {
    const server = createServer({ dirFlag: base, repoRoot: repo, watch: new RecordingWatch({ base, ...FAST }) });
    const client = await connectClient(server);
    expect(textOf(await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 1 } }))).toMatch(/^No new recording yet/);
    cpSync(FIXTURE, join(base, NEW), { recursive: true });
    expect(textOf(await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 10 } })).split("\n")[0]).toBe(`New recording ${NEW}.`);

    const wrong = await client.callTool({ name: "wait_for_recording", arguments: { timeoutSeconds: 1, repo: join(repo, "nope") } });
    expect(wrong.isError).toBe(true);
    await client.close();
    await server.close();
  });
});
