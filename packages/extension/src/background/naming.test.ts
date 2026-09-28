import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Naming (UX decision B) for every message built by the service worker, the offscreen document,
 * processing and the permission page: "Pointcast" in prose, lowercase `pointcast` only for the CLI
 * and npm packages, commands and file names. These messages reach notifications, the popup and
 * the pill, so a lowercase one here shows up next to Chrome's "Pointcast". The popup has its own
 * check (popup/naming.test.ts); this one reads the sources, since most of these strings are built
 * deep inside error paths.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOLDERS = ["background", "offscreen", "processing", "transcriber", "entrypoints/permission"];

/**
 * Lowercase uses that are names, not prose: paths and packages ("Downloads/pointcast/",
 * "@pointcast/core"), ids ("pointcast-sites"), a pinned version ("pointcast@0.2"), a quoted
 * command ("pointcast process"), and the "[pointcast]" prefix of console logs, which users never see.
 */
const ALLOWED = [/[/\\@]pointcast\b/g, /\bpointcast[/\\@-]/g, /["`]pointcast [^"`]*["`]/g, /\[pointcast\]/g];

/** Comments are for developers, and quote the product in many ways. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
}

/** String and template literals of a script; the text of a page. */
function texts(file: string, code: string): string[] {
  if (file.endsWith(".html")) return [code.replace(/<[^>]+>/g, " ")];
  return [...code.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map(([literal]) => literal);
}

function sources(): { file: string; code: string }[] {
  return FOLDERS.flatMap((folder) =>
    readdirSync(join(src, folder))
      .filter((name) => /\.(ts|html)$/.test(name) && !name.endsWith(".test.ts"))
      .map((name) => ({ file: `${folder}/${name}`, code: withoutComments(readFileSync(join(src, folder, name), "utf8")) })),
  );
}

function lowercaseInProse(text: string): boolean {
  return /\bpointcast\b/.test(ALLOWED.reduce((rest, pattern) => rest.replace(pattern, ""), text));
}

describe("naming rule B in the service worker, offscreen and permission messages", () => {
  it("knows prose from names", () => {
    expect(lowercaseInProse('"Saved by the pointcast MCP server"')).toBe(true);
    expect(lowercaseInProse('`run "pointcast process" later`')).toBe(false);
    expect(lowercaseInProse('"@pointcast/core"')).toBe(false);
    expect(lowercaseInProse('"[pointcast] could not report"')).toBe(false);
  });

  it("never writes the product in lowercase in a sentence", () => {
    const found = sources().flatMap(({ file, code }) => texts(file, code).filter(lowercaseInProse).map((text) => `${file}: ${text}`));
    expect(found).toEqual([]);
  });
});
