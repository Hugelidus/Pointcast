/// <reference types="node" />
/**
 * Loads the real playground pages into jsdom, so unit tests exercise the same markup the
 * manual test bench uses (Tailwind utilities, CSS modules, Vue/Angular attributes, …).
 * Test-only: nothing in the extension imports this file.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

export type PlaygroundPage = "index.html" | "other.html" | "spa.html";

// Plain paths, not URL objects: in the jsdom environment the global URL is jsdom's class,
// which node:fs does not accept.
const PLAYGROUND_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../../dev/playground");

export interface LoadOptions {
  /** Run the page's inline scripts (fake app behaviour such as "Delete removes the row"). */
  runScripts?: boolean;
  /** Query string and/or fragment appended to the page URL, e.g. "?view=/reports". */
  suffix?: string;
}

export function loadPlayground(page: PlaygroundPage, options: LoadOptions = {}): JSDOM {
  const html = readFileSync(join(PLAYGROUND_DIR, page), "utf8");
  return new JSDOM(html, {
    url: `http://localhost:5500/${page}${options.suffix ?? ""}`,
    ...(options.runScripts ? { runScripts: "dangerously" as const } : {}),
  });
}

/** Every element a user could click or select on the page: body and all its descendants. */
export function pointableElements(doc: Document): Element[] {
  return [doc.body, ...Array.from(doc.body.querySelectorAll("*"))].filter(
    (el) => el.localName !== "script" && el.localName !== "style",
  );
}
