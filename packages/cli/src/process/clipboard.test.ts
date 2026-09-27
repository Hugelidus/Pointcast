import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type CommandOutcome, copyMarkdownToClipboard, escapePowerShellLiteral, type RunClipboardCommand } from "./clipboard";

/**
 * Every test below injects a fake `run` (never the real `spawnSync`-backed default), so nothing
 * here ever touches the machine's real clipboard — required while Hugo is at the keyboard
 * copying/pasting elsewhere (DO NOT DISTURB). Windows cases do write a throwaway temp file
 * (that's disk I/O, not the clipboard) and always clean it up.
 */

const MARKDOWN = 'Se hizo clic en «Exportar» 🎯 y salió esto: "café con leche".';

function recordingRun(script: (command: string, args: string[], input: Buffer) => CommandOutcome) {
  const calls: Array<{ command: string; args: string[]; input: Buffer }> = [];
  const run: RunClipboardCommand = (command, args, input) => {
    calls.push({ command, args, input });
    return script(command, args, input);
  };
  return { run, calls };
}

const ok = (): CommandOutcome => ({ status: 0 });
const nonZero = (status: number): CommandOutcome => ({ status });
const enoent = (command: string): CommandOutcome => ({
  status: null,
  error: Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" }) as NodeJS.ErrnoException,
});
const otherError = (message: string, code: string): CommandOutcome => ({
  status: null,
  error: Object.assign(new Error(message), { code }) as NodeJS.ErrnoException,
});

describe("copyMarkdownToClipboard on darwin", () => {
  it("runs pbcopy with the exact UTF-8 bytes on stdin and no arguments", async () => {
    const { run, calls } = recordingRun(() => ok());
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "darwin", run });

    expect(outcome).toEqual({ copied: true });
    expect(calls).toEqual([{ command: "pbcopy", args: [], input: Buffer.from(MARKDOWN, "utf8") }]);
  });

  it("reports pbcopy missing without throwing", async () => {
    const { run } = recordingRun(() => enoent("pbcopy"));
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "darwin", run });

    expect(outcome).toEqual({ copied: false, reason: "no clipboard tool found (pbcopy is not installed)" });
  });

  it("reports a non-zero exit code", async () => {
    const { run } = recordingRun(() => nonZero(1));
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "darwin", run });

    expect(outcome).toEqual({ copied: false, reason: "pbcopy exited with code 1" });
  });

  it("reports a spawn error other than ENOENT", async () => {
    const { run } = recordingRun(() => otherError("spawn pbcopy EACCES", "EACCES"));
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "darwin", run });

    expect(outcome).toEqual({ copied: false, reason: "could not run pbcopy: spawn pbcopy EACCES" });
  });
});

describe("copyMarkdownToClipboard on linux", () => {
  it("prefers wl-copy when it is present", async () => {
    const { run, calls } = recordingRun((command) => (command === "wl-copy" ? ok() : nonZero(1)));
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "linux", run });

    expect(outcome).toEqual({ copied: true });
    expect(calls).toEqual([{ command: "wl-copy", args: [], input: Buffer.from(MARKDOWN, "utf8") }]);
  });

  it("falls back to xclip with its clipboard selection flags when wl-copy is missing", async () => {
    const { run, calls } = recordingRun((command) => (command === "wl-copy" ? enoent(command) : ok()));
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "linux", run });

    expect(outcome).toEqual({ copied: true });
    expect(calls.map((c) => c.command)).toEqual(["wl-copy", "xclip"]);
    expect(calls[1]).toEqual({ command: "xclip", args: ["-selection", "clipboard"], input: Buffer.from(MARKDOWN, "utf8") });
  });

  it("falls back to xsel with its clipboard/input flags when wl-copy and xclip are both missing", async () => {
    const { run, calls } = recordingRun((command) => (command === "xsel" ? ok() : enoent(command)));
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "linux", run });

    expect(outcome).toEqual({ copied: true });
    expect(calls.map((c) => c.command)).toEqual(["wl-copy", "xclip", "xsel"]);
    expect(calls[2]).toEqual({ command: "xsel", args: ["--clipboard", "--input"], input: Buffer.from(MARKDOWN, "utf8") });
  });

  it("reports that no tool was found when all three are missing", async () => {
    const { run } = recordingRun((command) => enoent(command));
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "linux", run });

    expect(outcome).toEqual({ copied: false, reason: "no clipboard tool found (tried wl-copy, xclip, xsel)" });
  });

  it("stops and reports a present-but-failing tool instead of masking it with a fallback", async () => {
    const { run, calls } = recordingRun((command) => (command === "wl-copy" ? nonZero(1) : ok()));
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "linux", run });

    // wl-copy exists (not ENOENT) but failed: that is reported as-is, xclip is never tried.
    expect(outcome).toEqual({ copied: false, reason: "wl-copy exited with code 1" });
    expect(calls.map((c) => c.command)).toEqual(["wl-copy"]);
  });
});

describe("copyMarkdownToClipboard on win32", () => {
  it("writes the Markdown as a UTF-8 temp file and pipes it into Set-Clipboard via -Encoding UTF8", async () => {
    const tempFilePath = path.join(tmpdir(), `pointcast-clipboard-test-${process.pid}.txt`);
    // The module deletes the temp file itself once the (fake) command has run, so its bytes
    // must be captured from inside the fake — by the time copyMarkdownToClipboard resolves,
    // cleanup has already happened, by design (see the "cleaned up" assertion below).
    let bytesAtSpawnTime: Buffer | undefined;
    const { run, calls } = recordingRun(() => {
      bytesAtSpawnTime = readFileSync(tempFilePath);
      return ok();
    });

    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "win32", run, tempFilePath });

    expect(outcome).toEqual({ copied: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("powershell.exe");
    expect(calls[0]!.args[0]).toBe("-NoProfile");
    expect(calls[0]!.args[1]).toBe("-NonInteractive");
    expect(calls[0]!.args[2]).toBe("-Command");
    expect(calls[0]!.args[3]).toBe(`Get-Content -LiteralPath '${tempFilePath}' -Raw -Encoding UTF8 | Set-Clipboard`);
    // Nothing is piped through the process's own stdin — the content travels via the file.
    expect(calls[0]!.input).toEqual(Buffer.alloc(0));

    // The exact bytes PowerShell will decode: plain UTF-8, no BOM, byte-for-byte the Markdown.
    expect(bytesAtSpawnTime).toEqual(Buffer.from(MARKDOWN, "utf8"));

    // Cleaned up afterwards — it is scratch, not something left behind on the user's disk.
    expect(existsSync(tempFilePath)).toBe(false);
  });

  it("doubles a single quote in the temp path so the PowerShell string literal stays valid", async () => {
    const tempFilePath = path.join(tmpdir(), `pointcast-o'brien-${process.pid}.txt`);
    const { run, calls } = recordingRun(() => ok());

    await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "win32", run, tempFilePath });

    expect(escapePowerShellLiteral("o'brien")).toBe("o''brien");
    expect(calls[0]!.args[3]).toContain(`o''brien`);
    expect(existsSync(tempFilePath)).toBe(false);
  });

  it("reports powershell.exe missing without throwing, and still cleans up the temp file", async () => {
    const tempFilePath = path.join(tmpdir(), `pointcast-clipboard-test-missing-${process.pid}.txt`);
    const { run } = recordingRun(() => enoent("powershell.exe"));

    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "win32", run, tempFilePath });

    expect(outcome).toEqual({ copied: false, reason: "no clipboard tool found (powershell.exe is not installed)" });
    expect(existsSync(tempFilePath)).toBe(false);
  });

  it("reports a non-zero exit code from powershell.exe", async () => {
    const tempFilePath = path.join(tmpdir(), `pointcast-clipboard-test-nonzero-${process.pid}.txt`);
    const { run } = recordingRun(() => nonZero(1));

    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "win32", run, tempFilePath });

    expect(outcome).toEqual({ copied: false, reason: "powershell.exe exited with code 1" });
    expect(existsSync(tempFilePath)).toBe(false);
  });
});

describe("copyMarkdownToClipboard on an unsupported platform", () => {
  it("reports it is unsupported instead of guessing at a tool", async () => {
    const { run, calls } = recordingRun(() => ok());
    const outcome = await copyMarkdownToClipboard({ markdown: MARKDOWN, platform: "freebsd", run });

    expect(outcome).toEqual({ copied: false, reason: "clipboard copy is not supported on freebsd" });
    expect(calls).toEqual([]);
  });
});
