import { parseArgs } from "node:util";
import { parseInstructionStyle, type InstructionStyle, type RenderFormat, type RenderLayout } from "@pointcast/core";
import { CliError } from "./errors";
import type { EngineName } from "./transcribe";

/** Options shared by both commands. */
export interface EngineChoice {
  engine: EngineName;
  model?: string;
  /** --language, else POINTCAST_LANGUAGE; undefined means "detect it" (local engine). */
  language?: string;
  threads?: number;
}

export type CliCommand =
  | { command: "usage"; exitCode: number }
  | { command: "version" }
  | ({ command: "transcribe"; target: string } & EngineChoice)
  | ({
      command: "process";
      target?: string;
      dir?: string;
      force: boolean;
      toStdout: boolean;
      noCopy?: boolean;
      format?: RenderFormat;
      /** --layout: code-first (default) or dom-first; kept so evaluations can compare both. */
      layout?: RenderLayout;
      /** --style: the preamble's instruction line, over the one the recording chose (InstructionStyle). */
      style?: InstructionStyle;
      /** --repo: project folder to resolve code pointers in (default: the current directory). */
      repo?: string;
    } & EngineChoice)
  | {
      command: "mcp";
      dir?: string;
      repo?: string;
      /** --no-handoff: do not receive recordings from the extension (handoff/config.ts). */
      noHandoff?: true;
    }
  | {
      command: "issue";
      target?: string;
      dir?: string;
      /** --repo owner/name on GitHub. */
      repo: string;
      ref?: string;
      /** create: open the issue through the API; dry-run: print it; open: prefilled issues/new URL. */
      mode: "create" | "dry-run" | "open";
      format?: RenderFormat;
    }
  | {
      command: "doctor";
      dir?: string;
      /** --online: also compare the version with the latest on npm (no network otherwise). */
      online?: true;
      /** --json: machine-readable report on stdout. */
      json?: true;
    }
  | {
      command: "setup";
      /** --repo: the project to set up (default: the current directory). */
      repo?: string;
      /** --yes: accept every step without asking. */
      yes?: true;
      /** --dry-run: print the plan only. */
      dryRun?: true;
      /** --json: machine-readable plan and outcome on stdout. */
      json?: true;
    };

/**
 * Turns argv (without the node and script paths) into a command. Pure, so the whole command
 * line surface is unit-tested without spawning the CLI. Every mistake becomes a CliError, which
 * main() prints as one line instead of a stack trace.
 */
export function parseCommandLine(argv: readonly string[], env: Record<string, string | undefined> = {}): CliCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: stripPnpmArgSeparator(argv),
      allowPositionals: true,
      options: {
        engine: { type: "string", default: "local" },
        model: { type: "string" },
        language: { type: "string" },
        threads: { type: "string" },
        dir: { type: "string" },
        force: { type: "boolean", default: false },
        stdout: { type: "boolean", default: false },
        "no-copy": { type: "boolean", default: false },
        "no-handoff": { type: "boolean", default: false },
        format: { type: "string" },
        layout: { type: "string" },
        style: { type: "string" },
        repo: { type: "string" },
        ref: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        open: { type: "boolean", default: false },
        online: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        yes: { type: "boolean", short: "y", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    // node:util reports unknown options and missing values with a TypeError. Its first sentence
    // says what is wrong ("Unknown option '--langauge'"); the rest is advice about "--" that
    // does not apply to this CLI.
    const [firstSentence = ""] = (error as Error).message.split(/(?<=\.) /);
    throw new CliError(`${firstSentence.replace(/\.?$/, ".")} Run "pointcast --help" for the options.`);
  }
  const { positionals, values } = parsed;
  if (values.help) return { command: "usage", exitCode: 0 };
  if (values.version) return { command: "version" };

  const engine = values.engine;
  if (engine !== "local" && engine !== "openai") {
    throw new CliError(`Unknown --engine "${engine}": expected "local" or "openai".`);
  }

  let threads: number | undefined;
  if (values.threads !== undefined) {
    // Number.parseInt would accept "4abc" as 4; a typo should be an error, not a guess.
    if (!/^\d+$/.test(values.threads) || Number(values.threads) <= 0) {
      throw new CliError(`--threads must be a positive integer, got "${values.threads}".`);
    }
    threads = Number(values.threads);
  }

  const language = values.language ?? (env.POINTCAST_LANGUAGE || undefined);
  const choice: EngineChoice = {
    engine,
    ...(values.model !== undefined ? { model: values.model } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(threads !== undefined ? { threads } : {}),
  };

  if (values.format !== undefined && values.format !== "classic" && values.format !== "requests") {
    throw new CliError(`Unknown --format "${values.format}": expected "classic" or "requests".`);
  }
  if (values.layout !== undefined && values.layout !== "code-first" && values.layout !== "dom-first") {
    throw new CliError(`Unknown --layout "${values.layout}": expected "code-first" or "dom-first".`);
  }

  const style = values.style === undefined ? undefined : parseInstructionStyle(values.style);
  if (values.style !== undefined && style === undefined) {
    throw new CliError(`Unknown --style "${values.style}": expected "intent" or "precise".`);
  }

  const [command, target, ...extra] = positionals;
  if (extra.length > 0) throw new CliError(`Unexpected extra arguments: ${extra.join(" ")}`);
  switch (command) {
    case "transcribe":
      return target ? { command, target, ...choice } : { command: "usage", exitCode: 1 };
    case "process":
      return {
        command,
        ...(target !== undefined ? { target } : {}),
        ...(values.dir !== undefined ? { dir: values.dir } : {}),
        force: values.force,
        toStdout: values.stdout,
        // Only present when true/given, like model/language/threads/dir above: existing tests
        // assert the full parsed object with toEqual, so an always-present field would break them.
        ...(values["no-copy"] ? { noCopy: true } : {}),
        ...(values.format !== undefined ? { format: values.format } : {}),
        ...(values.layout !== undefined ? { layout: values.layout } : {}),
        ...(style !== undefined ? { style } : {}),
        ...(values.repo !== undefined ? { repo: values.repo } : {}),
        ...choice,
      };
    case "mcp":
      return {
        command,
        ...(values.dir !== undefined ? { dir: values.dir } : {}),
        ...(values.repo !== undefined ? { repo: values.repo } : {}),
        ...(values["no-handoff"] ? { noHandoff: true } : {}),
      };
    case "issue":
      if (values.repo === undefined) throw new CliError('issue needs --repo owner/name (the GitHub repository to file it in).');
      if (values["dry-run"] && values.open) throw new CliError("Pass either --dry-run or --open, not both.");
      return {
        command,
        ...(target !== undefined ? { target } : {}),
        ...(values.dir !== undefined ? { dir: values.dir } : {}),
        repo: values.repo,
        ...(values.ref !== undefined ? { ref: values.ref } : {}),
        mode: values["dry-run"] ? "dry-run" : values.open ? "open" : "create",
        ...(values.format !== undefined ? { format: values.format } : {}),
      };
    case "doctor":
      if (target !== undefined) throw new CliError(`doctor takes no arguments, got "${target}". Use --dir for the sessions folder.`);
      return {
        command,
        ...(values.dir !== undefined ? { dir: values.dir } : {}),
        ...(values.online ? { online: true } : {}),
        ...(values.json ? { json: true } : {}),
      };
    case "setup":
      if (target !== undefined) throw new CliError(`setup takes no arguments, got "${target}". Use --repo for the project folder.`);
      return {
        command,
        ...(values.repo !== undefined ? { repo: values.repo } : {}),
        ...(values.yes ? { yes: true } : {}),
        ...(values["dry-run"] ? { dryRun: true } : {}),
        ...(values.json ? { json: true } : {}),
      };
    default:
      return { command: "usage", exitCode: 1 };
  }
}

/**
 * `pnpm --filter pointcast start -- <command> ...` has pnpm insert a literal "--" before the
 * forwarded args. node:util's parseArgs treats "--" as "everything after is positional", which
 * would silently turn --engine/--model/... into positionals, so one leading "--" is dropped.
 */
function stripPnpmArgSeparator(args: readonly string[]): string[] {
  return args[0] === "--" ? args.slice(1) : [...args];
}

export const USAGE = [
  "Usage: pointcast <command> [options]",
  "",
  "Commands:",
  "  setup                                  Set pointcast up in this project: finds your coding agents",
  "                                         (Claude Code, Codex, Gemini CLI, Cursor) and adds",
  "                                         pointcast's MCP server to each, says what your stack needs",
  "                                         (Django, React, Vue, Svelte) and how to add the browser",
  "                                         extension, then runs doctor. Asks before each change.",
  "  transcribe <session-dir | file.wav>   Write words.json from audio.",
  "  process [session-dir]                 Transcribe (if needed), fuse and render session.md.",
  "                                         Default session-dir: the latest session in",
  "                                         --dir / POINTCAST_DIR / <Downloads>/pointcast.",
  "  mcp                                    Run a stdio MCP server exposing sessions read-only",
  "                                         (list_sessions, get_session, get_element). While it",
  "                                         runs, it also receives the extension's recordings on",
  "                                         127.0.0.1, so they skip Chrome's downloads.",
  "  issue [session-dir] --repo owner/name  File the spec as a GitHub issue, with code locations",
  "                                         resolved in that repo and linked to its source.",
  "  doctor                                 Check this machine's setup (Node.js, the sessions",
  "                                         folder, the MCP server receiving recordings, local",
  "                                         transcription, the clipboard), with a fix for each",
  "                                         problem. Read-only; exits 1 when something needed fails.",
  "",
  "Options:",
  "  --engine <local|openai>  Transcription backend (default: local)",
  "  --model <id>             local: Xenova/whisper-base (default; the extension's Fast) or",
  "                           Xenova/whisper-small (its Accurate: fewer misheard words, about",
  "                           twice as slow, 512 MB download once); openai: default whisper-1",
  "  --language <code>        Spoken language, e.g. es, en (default: POINTCAST_LANGUAGE, else detected)",
  "  --threads <n>            ONNX thread count (local engine only)",
  "  --dir <path>             process/mcp/issue/doctor: folder to find sessions in",
  "  --force                  process: re-transcribe even if words.json exists",
  "  --stdout                 process: write the Markdown to stdout instead of session.md",
  "  --no-copy                process: do not copy the Markdown to the clipboard",
  "                           (copying is skipped automatically with --stdout, or when no",
  "                           clipboard tool is found)",
  "  --no-handoff             mcp: do not receive recordings from the extension",
  "                           (also POINTCAST_HANDOFF=off)",
  "  --format <classic|requests>  process/issue: Markdown style passed to the renderer (default: requests)",
  "  --layout <code-first|dom-first>  process: where an element's code is known, lead with it",
  "                           (code-first, default) or with the on-screen element (dom-first)",
  "  --style <intent|precise>  process: how the spec tells the agent to apply the requests:",
  "                           intent builds what a request for something new means, in the",
  "                           app's style; precise changes only what was pointed at, as asked",
  "                           (default: what the recording chose in the popup, else intent)",
  "  --repo <path>            process/mcp: project folder to resolve code locations in;",
  "                           setup: the project to set up",
  "                           (default: the current directory, when the recording's files are there)",
  "  --repo <owner/name>      issue: GitHub repository to resolve in and file the issue in",
  "  --ref <branch|tag|sha>   issue: version of the repository to read (default: its default branch)",
  "  --dry-run                issue: print the title and body instead of creating the issue;",
  "                           setup: print the plan and change nothing (also without a terminal)",
  "  -y, --yes                setup: do every step without asking",
  "  --open                   issue: print (and open) a prefilled github.com/…/issues/new link instead",
  "                           of creating it through the API; needs no token",
  "  --online                 doctor: also compare the version with the latest on npm",
  "  --json                   doctor/setup: print the report as JSON (setup: a dry run without --yes)",
  "  -h, --help               Show this help",
  "  -v, --version            Show the version",
  "",
  "Environment: POINTCAST_DIR, POINTCAST_LANGUAGE; for mcp: POINTCAST_HANDOFF,",
  "POINTCAST_EXTENSION_IDS (more extension ids to accept recordings from, comma-separated); for",
  "--engine openai: POINTCAST_API_BASE, POINTCAST_API_KEY (OPENAI_API_KEY is used only for",
  "api.openai.com); for issue: GITHUB_TOKEN (else the token of the gh CLI, if logged in).",
].join("\n");
