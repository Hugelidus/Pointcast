import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionFile } from "@pointcast/core";
import { getSession } from "../mcp/sessions";
import { runProcess } from "./run";

/** A typed session as the extension saves it (D12): session.json only, no audio, no words.json. */
const TYPED: SessionFile = {
  schemaVersion: 2,
  id: "2026-09-28_10-00-00",
  startedAt: "2026-09-28T08:00:00.000Z",
  t0: 1790000000000,
  durationMs: 12000,
  recorder: { extensionVersion: "0.4.0", userAgent: "test" },
  inputMode: "typed",
  events: [
    {
      id: "e1",
      gesture: "point",
      tStart: 2000,
      tEnd: 2000,
      url: "http://127.0.0.1:5500/index.html",
      element: {
        tag: "button",
        text: "Export",
        selector: "#export-btn",
        selectorUnique: true,
        path: "main › button#export-btn",
        html: "<button>Export</button>",
      },
      note: "Export only the filtered orders.",
    },
  ],
};

describe("a typed session (no words.json, no audio)", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "pointcast-cli-typed-"));
    writeFileSync(join(sessionDir, "session.json"), JSON.stringify(TYPED));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("is processed from its notes without transcribing, even with --force", async () => {
    for (const force of [false, true]) {
      const result = await runProcess({ sessionDir, engine: "local", force, toStdout: false });
      expect(result).toMatchObject({ typed: true, transcribed: false, header: expect.stringMatching(/^1 request · 1 element · ~\d+ tokens$/) });
      expect(result.markdown).toContain("> Export only the filtered orders. [a]");
      expect(readFileSync(join(sessionDir, "session.md"), "utf8")).toBe(result.markdown);
      expect(existsSync(join(sessionDir, "words.json"))).toBe(false);
    }
  });

  it("is rendered by get_session", async () => {
    const result = await getSession(sessionDir);
    expect(result.rendered).toBe(true);
    expect(result.markdown).toContain("> Export only the filtered orders. [a]");
    expect(result.header).toMatch(/^1 request · 1 element · /);
  });
});
