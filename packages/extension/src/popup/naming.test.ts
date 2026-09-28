import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { ProcessingInfo } from "../processing/progress";
import type { RecorderState } from "../recorder-state";
import {
  firstRunNotice,
  lastEventText,
  metaLine,
  popupView,
  processingPanel,
  resultView,
  shortcutHint,
  siteView,
  tabCaptureView,
  undoneText,
} from "./view";

/**
 * Naming (UX decision B): "Pointcast" in every sentence the user reads; `pointcast` in lowercase
 * only for the CLI and npm packages, commands and file names. The popup said "pointcast" inside
 * while Chrome's toolbar said "Pointcast", and a rule with exceptions stops being followed, so
 * this test fails on a lowercase one in the popup's prose.
 */

const here = dirname(fileURLToPath(import.meta.url));
const popupDir = join(here, "..", "entrypoints", "popup");

/**
 * Lowercase uses that are names of things, not prose: a folder or package in a path
 * ("Downloads › pointcast", "Downloads/pointcast/", "@pointcast/core"), and a quoted command
 * ("pointcast process"). They are removed before the check.
 */
const ALLOWED = [/Downloads › pointcast\b/g, /[/\\@]pointcast\b/g, /\bpointcast[/\\@-]/g, /["`]pointcast [^"`]*["`]/g];

function prose(text: string): string {
  return ALLOWED.reduce((rest, pattern) => rest.replace(pattern, ""), text);
}

function lowercaseNames(texts: Iterable<string>): string[] {
  return [...texts].filter((text) => /\bpointcast\b/.test(prose(text)));
}

/** Every string inside a view object, however deep. */
function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) yield* strings(item);
}

describe("naming rule B", () => {
  it("knows prose from names", () => {
    expect(lowercaseNames(["Send to a running pointcast MCP server"])).toHaveLength(1);
    expect(lowercaseNames(["pointcast is off on example.com."])).toHaveLength(1);
    expect(lowercaseNames(["Saved to Downloads/pointcast/s1/", 'run "pointcast process"', "@pointcast/core", "Pointcast"])).toEqual(
      [],
    );
  });

  it("holds in the popup's HTML: text, and the attributes people read", () => {
    const html = readFileSync(join(popupDir, "index.html"), "utf8");
    // A real HTML parser, not regexes: comments are not text, and scripts and styles are removed.
    const { document } = new JSDOM(html).window;
    for (const node of document.querySelectorAll("script, style")) node.remove();
    const attributes = [...document.querySelectorAll("[title], [alt], [aria-label], [placeholder]")].flatMap((el) =>
      ["title", "alt", "aria-label", "placeholder"].flatMap((name) => el.getAttribute(name) ?? []),
    );
    const text = (document.body?.textContent ?? "").split("\n");
    expect(lowercaseNames([...attributes, ...text])).toEqual([]);
  });

  it("holds in the popup script's own messages", () => {
    const source = readFileSync(join(popupDir, "main.ts"), "utf8");
    // Log lines and imports are for developers; the rest of the literals can reach the user.
    const code = source
      .split("\n")
      .filter((line) => !/console\.|^\s*import\b|^\s*\*|^\s*\/\//.test(line))
      .join("\n");
    const literals = [...code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
    expect(lowercaseNames(literals)).toEqual([]);
  });

  it("holds in everything the view functions say, in every state", () => {
    const info: ProcessingInfo = { startedAt: 0, audioMs: 5_000, stage: "transcribing", estimatedEnd: 9_000, deadline: 1e9, firstRun: false };
    const lastResult = { sessionId: "s1", finishedAt: 1, copied: true, downloadId: 3, audioMs: 5_000, processingMs: 1_000, code: "Code pointer: x." };
    const states: RecorderState[] = [
      { status: "idle" },
      { status: "starting" },
      { status: "recording", t0: 1 },
      { status: "stopping", processing: { ...info, stage: "stopping", firstRun: true } },
      { status: "processing", processing: { ...info, stage: "downloading-model", firstRun: true, loadedBytes: 1e6, totalBytes: 2e6 } },
      { status: "processing", processing: info },
      { status: "processing", processing: { ...info, stage: "saving" } },
      { status: "idle", lastSessionId: "s1", lastResult },
      { status: "idle", lastSessionId: "s1", lastResult: { ...lastResult, copied: false, handedOffTo: "~/x/y/z/s1" } },
      { status: "idle", lastSessionId: "s1", lastResult, warning: "Something. More." },
    ];
    const said: unknown[] = [];
    for (const state of states) {
      for (const microphone of ["granted", "prompt", "denied"] as const) {
        said.push(popupView(state, { microphone, offSite: true }), firstRunNotice(state, microphone, false));
      }
      said.push(processingPanel(state, 1_000), resultView(state, true), metaLine(state, 2), lastEventText(state, "a «x» · click"));
      for (const capture of [{ status: "attached" }, { status: "not-local" }, { status: "unavailable", error: "e" }] as const) {
        said.push(tabCaptureView(capture, state), tabCaptureView(capture, state, "example.com"));
      }
    }
    said.push(
      siteView({ host: "example.com", enabled: false }),
      siteView({ host: "example.com", enabled: true }),
      shortcutHint("", ""),
      shortcutHint("Alt+Shift+S", "Alt+Shift+U"),
      undoneText("button «Export» · Alt+click"),
    );
    expect(lowercaseNames(strings(said))).toEqual([]);
  });
});
