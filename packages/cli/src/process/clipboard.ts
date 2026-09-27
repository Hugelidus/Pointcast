import { spawnSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Copies `session.md`'s Markdown to the system clipboard after `process` writes it, so the user
 * can paste it straight into their coding agent without a manual Ctrl+C from an editor. Every
 * failure path here returns a reason instead of throwing: a clipboard tool that is missing,
 * errors, or times out must never fail the `process` command (index.ts logs the reason and
 * moves on).
 *
 * The one thing every platform must get right is round-tripping non-ASCII exactly (accents,
 * angle quotes «», emoji): the fusion output is Spanish captured audio, so this is not an edge
 * case. That is also why the process runner is injected — tests assert the exact command,
 * arguments and bytes a real invocation would send, without ever touching the real clipboard.
 */

export interface CommandOutcome {
  /** Exit code of the finished process; null when it never started (see `error`). */
  status: number | null;
  /** Set when spawning itself failed (ENOENT: not installed; EACCES; a timeout; ...). */
  error?: NodeJS.ErrnoException;
}

/** `input` is always provided (possibly empty) so a fake can assert on it unconditionally. */
export type RunClipboardCommand = (command: string, args: string[], input: Buffer) => CommandOutcome;

export interface CopyToClipboardOptions {
  markdown: string;
  /** Defaults to `process.platform`; overridable so tests can exercise every branch on any OS. */
  platform?: NodeJS.Platform;
  /** Defaults to a real `spawnSync`-backed runner; tests inject a fake. */
  run?: RunClipboardCommand;
  /** Windows only: where to stage the temp file `Set-Clipboard` reads from (see below). Tests
   *  override this to avoid depending on `os.tmpdir()` and to exercise path-escaping. */
  tempFilePath?: string;
}

export interface ClipboardOutcome {
  copied: boolean;
  /** Present exactly when `copied` is false: why, for the CLI's one-line status message. */
  reason?: string;
}

function runOne(command: string, args: string[], input: Buffer, run: RunClipboardCommand): ClipboardOutcome {
  const { status, error } = run(command, args, input);
  if (error) {
    return error.code === "ENOENT"
      ? { copied: false, reason: `no clipboard tool found (${command} is not installed)` }
      : { copied: false, reason: `could not run ${command}: ${error.message}` };
  }
  if (status !== 0) return { copied: false, reason: `${command} exited with code ${status}` };
  return { copied: true };
}

/**
 * Tries each tool in order, moving to the next only when the current one is simply not
 * installed (ENOENT). A tool that exists but fails (bad exit code, permission error, timeout)
 * is a real problem worth surfacing as-is, not a reason to silently mask it behind a fallback.
 */
function runFirstAvailable(
  tools: ReadonlyArray<{ command: string; args: string[] }>,
  input: Buffer,
  run: RunClipboardCommand,
): ClipboardOutcome {
  const missing: string[] = [];
  for (const tool of tools) {
    const outcome = runOne(tool.command, tool.args, input, run);
    if (outcome.copied) return outcome;
    if (outcome.reason?.startsWith("no clipboard tool found")) {
      missing.push(tool.command);
      continue;
    }
    return outcome;
  }
  return { copied: false, reason: `no clipboard tool found (tried ${missing.join(", ")})` };
}

/**
 * Windows has no `pbcopy`/`xclip` equivalent on PATH, so this shells out to PowerShell's
 * `Set-Clipboard` — but *never* by piping the Markdown through a process's stdin. Two things
 * that look obvious both mangle non-ASCII:
 *
 *  - `clip.exe` (the classic tool) decodes stdin using the console's active codepage, not
 *    UTF-8; accents, «» and emoji come out as mojibake or "?". There is no supported flag to
 *    tell it "this stdin is UTF-8".
 *  - Piping into `powershell.exe`'s own stdin has the same problem one level up: Windows
 *    PowerShell 5.1's pipeline input encoding defaults to the OEM codepage (not UTF-8 or even
 *    ASCII-clean), so `Get-Content | Set-Clipboard`-via-stdin round-trips ASCII fine and breaks
 *    on everything else — exactly the failure mode this feature exists to avoid.
 *
 * The fix is to never let an external process guess the encoding: write the Markdown to a temp
 * file as plain UTF-8 (Node's default, no BOM), then have PowerShell decode *that file* with an
 * explicit `-Encoding UTF8` (a file read has no codepage ambiguity — the flag says exactly what
 * it is). `Get-Content -Raw` reads it back as one string with its original line endings intact,
 * and `Set-Clipboard` (PowerShell 5.0+, so present on every supported Windows) puts that exact
 * .NET Unicode string on the clipboard as CF_UNICODETEXT. The path travels through `-Command` as
 * a single PowerShell single-quoted string literal (embedded `'` doubled per PowerShell's own
 * escaping rule) rather than through argv-splicing the Markdown itself, which sidesteps both
 * argv length limits and having to escape arbitrary Markdown content.
 */
async function copyOnWindows(
  markdown: string,
  run: RunClipboardCommand,
  tempFilePath: string | undefined,
): Promise<ClipboardOutcome> {
  const filePath = tempFilePath ?? path.join(tmpdir(), `pointcast-clipboard-${process.pid}-${Date.now()}.txt`);

  try {
    await writeFile(filePath, markdown, "utf8");
  } catch (error) {
    return { copied: false, reason: `could not write a temp file for the clipboard: ${(error as Error).message}` };
  }

  try {
    const script = `Get-Content -LiteralPath '${escapePowerShellLiteral(filePath)}' -Raw -Encoding UTF8 | Set-Clipboard`;
    return runOne("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], Buffer.alloc(0), run);
  } finally {
    // Best-effort: a leftover temp file is harmless clutter, not a reason to report failure.
    await unlink(filePath).catch(() => {});
  }
}

/** PowerShell single-quoted string literals escape `'` by doubling it; nothing else is special. */
export function escapePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function defaultRun(command: string, args: string[], input: Buffer): CommandOutcome {
  // windowsHide: never flash a console window (matches downloads-dir.ts's reg query).
  // timeout: every known clipboard tool forks/returns almost instantly; this is a backstop
  // against a hang on some exotic setup, not an expected path.
  const result = spawnSync(command, args, { input, windowsHide: true, timeout: 5000 });
  return { status: result.status, error: result.error as NodeJS.ErrnoException | undefined };
}

export async function copyMarkdownToClipboard(options: CopyToClipboardOptions): Promise<ClipboardOutcome> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? defaultRun;
  const input = Buffer.from(options.markdown, "utf8");

  switch (platform) {
    case "darwin":
      return runOne("pbcopy", [], input, run);
    case "linux":
      // wl-copy (Wayland) first, then the two X11 tools; whichever is actually installed wins.
      return runFirstAvailable(
        [
          { command: "wl-copy", args: [] },
          { command: "xclip", args: ["-selection", "clipboard"] },
          { command: "xsel", args: ["--clipboard", "--input"] },
        ],
        input,
        run,
      );
    case "win32":
      return copyOnWindows(options.markdown, run, options.tempFilePath);
    default:
      return { copied: false, reason: `clipboard copy is not supported on ${platform}` };
  }
}
