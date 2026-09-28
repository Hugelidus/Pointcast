import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionFile } from "@pointcast/core";

/**
 * Test data shared by the route tests (local repo, MCP, GitHub): the e2e-es-v2 fixture with a
 * code chain on its "Export" button (e2), and the source files that chain names.
 */

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../dev/fixtures/sessions/e2e-es-v2");

export const TOOLBAR = "src/components/Toolbar.tsx";
export const APP = "src/App.tsx";

/** "Export" is written once, on line 4: the resolver's `text at:` line. */
export const SOURCES: Record<string, string> = {
  [TOOLBAR]: [
    "export function Toolbar() {",
    "  return (",
    '    <button type="button" id="export-btn">',
    "      Export",
    "    </button>",
    "  );",
    "}",
  ].join("\n"),
  [APP]: [
    'import { Toolbar } from "./components/Toolbar";',
    "export default function App() {",
    "  return <main><Toolbar /></main>;",
    "}",
  ].join("\n"),
};

/** The resolver's snippet for that line: "Export" alone says little, so the lines around it come too. */
export const EXPORT_SNIPPET = '<button type="button" id="export-btn"> Export </button>';

/** A scratch copy of the fixture session whose e2 has `renderedBy`; returns its folder. */
export function sessionWithChain(): string {
  const dir = mkdtempSync(join(tmpdir(), "pointcast-chain-session-"));
  cpSync(FIXTURE, dir, { recursive: true });
  const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as SessionFile;
  const event = session.events.find((e) => e.id === "e2")!;
  event.element.renderedBy = [
    { file: TOOLBAR, line: 3 },
    { component: "Toolbar", file: APP, line: 3 },
  ];
  writeFileSync(join(dir, "session.json"), JSON.stringify(session, null, 2));
  return dir;
}

/** A scratch project with `files` written under `prefix` ("apps/web/" for a monorepo package). */
export function projectWith(files: Record<string, string>, prefix = ""): string {
  const root = mkdtempSync(join(tmpdir(), "pointcast-repo-"));
  for (const [file, source] of Object.entries(files)) {
    const target = join(root, prefix, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}
