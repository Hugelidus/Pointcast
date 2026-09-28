#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { unreliableTimes, type WordsFile } from "@pointcast/core";
import { parseCommandLine, USAGE, type CliCommand } from "./args";
import { readAudioSamples } from "./audio/read-audio";
import { resolveAudioTarget } from "./audio-target";
import { CliError } from "./errors";
import { githubToken, repoLabel } from "./github/api";
import { runIssue } from "./github/issue";
import { resolveHandoffSettings } from "./handoff/config";
import { copyMarkdownToClipboard } from "./process/clipboard";
import { resolveSessionDir } from "./process/discover";
import { runProcess } from "./process/run";
import { runMcpServer } from "./mcp/server";
import { describeResolution } from "./resolve/local";
import { createEngine } from "./transcribe";
import { VERSION } from "./version";

/**
 * D2: the extension only captures; this CLI does transcription, fusion and rendering.
 * `transcribe` (plan step 3) is the transcription half on its own — `words.json` is cached
 * (session-format.md) so re-running fusion later never re-pays for it. `process` (plan step
 * 13) is the end-to-end command: it transcribes only when words.json is missing (or --force),
 * then runs core's fuse/render and writes session.md.
 *
 * Status messages go to stderr: with `process --stdout`, stdout must carry nothing but the
 * Markdown, so a shell redirect (`pointcast process --stdout > spec.md`) gets a clean file.
 */
const log = (message: string) => console.error(`[pointcast] ${message}`);

/**
 * Paths are relative to where the user typed the command. `pnpm --filter pointcast start`
 * (and the root `pnpm pointcast` script) run inside packages/cli, but pnpm and npm record the
 * original directory in INIT_CWD.
 */
function fromUserCwd(target: string): string;
function fromUserCwd(target: string | undefined): string | undefined;
function fromUserCwd(target: string | undefined): string | undefined {
  return target === undefined ? undefined : path.resolve(process.env.INIT_CWD ?? process.cwd(), target);
}

async function main(): Promise<void> {
  const command = parseCommandLine(process.argv.slice(2), process.env);
  switch (command.command) {
    case "usage":
      (command.exitCode === 0 ? console.log : console.error)(USAGE);
      process.exitCode = command.exitCode;
      return;
    case "version":
      console.log(VERSION);
      return;
    case "transcribe":
      return runTranscribe(command);
    case "process":
      return runProcessCommand(command);
    case "mcp": {
      // D11: recordings from the extension land in the same folder, with no Save dialogs. A bad
      // handoff setting only turns the receiver off: the agent keeps its tools.
      const handoff = resolveHandoffSettings(command.noHandoff === true, process.env, log);
      return runMcpServer({
        dirFlag: fromUserCwd(command.dir),
        envDir: fromUserCwd(process.env.POINTCAST_DIR || undefined),
        // Claude Code sets CLAUDE_PROJECT_DIR for the servers it starts; their working directory
        // is not always the project (plugin and user-scope servers start in ~/.claude).
        repoRoot: fromUserCwd(command.repo ?? (process.env.CLAUDE_PROJECT_DIR || ".")),
        handoffPort: handoff.port,
        allowedExtensionIds: handoff.allowedExtensionIds,
      });
    }
    case "issue":
      return runIssueCommand(command);
  }
}

/** Says which language was used when the user did not choose one, so a wrong guess is visible. */
function logDetectedLanguage(requested: string | undefined, words: WordsFile): void {
  if (requested === undefined && words.language) {
    log(`language: ${words.language} (detected; pass --language to force another)`);
  }
}

/** The spec says it too (core's renderer); the terminal says it where the user is looking. */
function logUnreliable(words: WordsFile): void {
  const times = unreliableTimes(words);
  if (times) log(`warning: the transcript around ${times} looked unreliable and was dropped`);
}

async function runTranscribe(command: Extract<CliCommand, { command: "transcribe" }>): Promise<void> {
  const { audioPath, wordsPath } = await resolveAudioTarget(fromUserCwd(command.target));
  const samples = await readAudioSamples(audioPath);

  const engine = createEngine(command.engine, { model: command.model, threads: command.threads });
  log(`transcribing ${audioPath} with ${engine.name}...`);
  const words = await engine.transcribe(samples, { language: command.language });
  logDetectedLanguage(command.language, words);
  logUnreliable(words);

  await writeFile(wordsPath, JSON.stringify(words, null, 2), "utf8");
  log(`wrote ${wordsPath} (${words.words.length} words)`);
}

async function runProcessCommand(command: Extract<CliCommand, { command: "process" }>): Promise<void> {
  const { dir: sessionDir, reason } = await resolveSessionDir({
    explicit: fromUserCwd(command.target),
    dirFlag: fromUserCwd(command.dir),
    envDir: fromUserCwd(process.env.POINTCAST_DIR || undefined),
  });
  log(`session: ${sessionDir} (${reason})`);

  const result = await runProcess({
    sessionDir,
    engine: command.engine,
    model: command.model,
    language: command.language,
    threads: command.threads,
    force: command.force,
    toStdout: command.toStdout,
    format: command.format,
    layout: command.layout,
    // Route 1: --repo, else the current directory, used only if the recording's files are there.
    repo: { root: fromUserCwd(command.repo ?? "."), explicit: command.repo !== undefined },
  });
  if (result.resolution) log(describeResolution(result.resolution, { explicit: command.repo !== undefined }));

  if (result.transcribed) {
    logDetectedLanguage(command.language, result.words);
    log(`transcribed with ${result.words.engine} (${result.words.words.length} words)`);
    logUnreliable(result.words);
  } else {
    log("words.json already present, skipped transcription (--force to redo it)");
  }
  log(`${result.summaryLine} · ${result.chars} chars · ~${result.tokens} tokens`);
  if (command.toStdout) {
    // A reader that stops early (`| head`) closes the pipe: that is not an error worth a stack.
    process.stdout.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
    process.stdout.write(result.markdown);
  } else {
    log(`wrote ${result.sessionMdPath}`);
  }
  await logClipboardOutcome(command, result.markdown);
}

/**
 * Paste-ready by default: the whole point is skipping the manual "open session.md, select all,
 * copy" before pasting into a coding agent. `--stdout` already puts the Markdown where the user
 * is piping it, so copying too would be redundant; `--no-copy` opts out entirely. Any other skip
 * (no clipboard tool found, the tool errored) is decided by clipboard.ts; either way this never
 * throws — failing to copy must never fail `process` itself.
 */
async function logClipboardOutcome(
  command: Extract<CliCommand, { command: "process" }>,
  markdown: string,
): Promise<void> {
  if (command.toStdout) {
    log("did not copy to clipboard (--stdout)");
    return;
  }
  if (command.noCopy) {
    log("did not copy to clipboard (--no-copy)");
    return;
  }
  const outcome = await copyMarkdownToClipboard({ markdown });
  log(outcome.copied ? "copied to clipboard" : `did not copy to clipboard (${outcome.reason})`);
}

async function runIssueCommand(command: Extract<CliCommand, { command: "issue" }>): Promise<void> {
  const { dir: sessionDir, reason } = await resolveSessionDir({
    explicit: fromUserCwd(command.target),
    dirFlag: fromUserCwd(command.dir),
    envDir: fromUserCwd(process.env.POINTCAST_DIR || undefined),
  });
  log(`session: ${sessionDir} (${reason})`);

  const token = await githubToken(process.env);
  const result = await runIssue({
    sessionDir,
    repo: command.repo,
    ...(command.ref !== undefined ? { ref: command.ref } : {}),
    mode: command.mode,
    format: command.format,
    client: { fetch, ...(token ? { token } : {}) },
  });
  const at = `${repoLabel(result.repo)}@${result.sha.slice(0, 7)}`;
  if (result.matches === undefined) log(`code locations: none to resolve (the recording has no component chain)`);
  else if (result.matches) log(`code locations: ${result.found} found in ${at}`);
  else log(`warning: none of the recording's source files (${result.files.slice(0, 2).join(", ")}) is in ${at}; wrong --repo or --ref?`);

  // stdout carries only the result (the issue URL, the link, or the title and body), so it can
  // be piped; everything else goes to stderr, as for `process --stdout`.
  if (command.mode === "create") {
    log(`created issue #${result.url?.split("/").pop()}`);
    process.stdout.write(`${result.url}\n`);
  } else if (command.mode === "open" && result.url !== undefined) {
    process.stdout.write(`${result.url}\n`);
    openInBrowser(result.url);
  } else {
    if (command.mode === "open") {
      const newIssue = `https://github.com/${repoLabel(result.repo)}/issues/new`;
      log(`the issue (${result.body.length} characters) is too long for a prefilled link: paste this title and body into ${newIssue}`);
    }
    process.stdout.write(`${result.title}\n\n${result.body}`);
  }
}

/** Best effort: the link is printed first, so failing to open a browser only costs a click. */
function openInBrowser(url: string): void {
  // rundll32 hands the URL to the default browser without a shell parsing its "&"s.
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", () => log("could not open a browser: open the link above"));
  child.unref();
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    log(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
