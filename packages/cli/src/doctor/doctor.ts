import { stat } from "node:fs/promises";
import path from "node:path";
import { HANDOFF_HOST, HANDOFF_PORT, HANDOFF_PROTOCOL } from "@pointcast/core";
import { listSessionDirs, resolveSessionsBase, type SessionDirs } from "../process/discover";
import { downloadsDir } from "../process/downloads-dir";
import { latestNpmVersion, onPath, probeReceiver, transformersInstalled, type ReceiverProbe } from "./probe";

/**
 * `pointcast doctor`: a few lines that say whether this machine's setup works, each problem with
 * its fix. Read-only: it lists the sessions folder, says hello on the handoff port (never sends a
 * recording), resolves (never loads) transformers.js, looks for clipboard tools on PATH (never
 * runs them), and asks npm for the latest version only with --online.
 *
 * "fail" is for what `pointcast` cannot work without (an old Node.js, a --dir / POINTCAST_DIR that
 * does not exist); everything optional (the extension handoff, local transcription, the
 * clipboard, updates) is at most a "warn". The exit code is 1 only when a check failed.
 */

export const MIN_NODE_VERSION = "22.12.0";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: "node" | "sessions" | "receiver" | "transcription" | "clipboard" | "version";
  status: CheckStatus;
  /** One line: what was found. */
  summary: string;
  /** What to do about it; present for warn and fail. */
  fix?: string;
  /** Something worth knowing about a check that passed. */
  note?: string;
}

export interface DoctorReport {
  version: string;
  /** false when any check failed. */
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  /** --dir, already resolved against the user's cwd. */
  dirFlag?: string;
  /** POINTCAST_DIR, already resolved. */
  envDir?: string;
  /** --online: compare with the latest version on npm. */
  online: boolean;
}

export interface DoctorDependencies {
  version: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  /** The Downloads folder (downloads-dir.ts: registry on Windows, xdg-user-dirs on Linux). */
  downloadsDir: () => string;
  listSessions: (base: string) => Promise<SessionDirs>;
  /** Whether `base` exists as a folder. */
  isDirectory: (base: string) => Promise<boolean>;
  probeReceiver: () => Promise<ReceiverProbe>;
  transformersInstalled: () => boolean;
  onPath: (command: string) => boolean;
  latestNpmVersion: () => Promise<string | undefined>;
}

export const defaultDoctorDependencies = (version: string): DoctorDependencies => ({
  version,
  nodeVersion: process.versions.node,
  platform: process.platform,
  downloadsDir: () => downloadsDir(),
  listSessions: listSessionDirs,
  isDirectory: (base) => stat(base).then((s) => s.isDirectory(), () => false),
  probeReceiver: () => probeReceiver(HANDOFF_PORT),
  transformersInstalled,
  onPath: (command) => onPath(command),
  latestNpmVersion: () => latestNpmVersion(),
});

/** The clipboard tools clipboard.ts tries on Linux, in its order. */
export const LINUX_CLIPBOARD_TOOLS = ["wl-copy", "xclip", "xsel"] as const;

/** -1, 0 or 1; "22.12.0" style, missing parts count as 0, a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

function checkNode(nodeVersion: string): DoctorCheck {
  if (compareVersions(nodeVersion, MIN_NODE_VERSION) >= 0) return { id: "node", status: "ok", summary: `Node.js ${nodeVersion}` };
  return {
    id: "node",
    status: "fail",
    summary: `Node.js ${nodeVersion} is too old: pointcast needs ${MIN_NODE_VERSION.replace(/\.0$/, "")} or newer`,
    fix: "Install the current Node.js LTS from https://nodejs.org (or with your version manager), then run it again.",
  };
}

async function checkSessions(options: DoctorOptions, deps: DoctorDependencies): Promise<DoctorCheck> {
  const source = options.dirFlag !== undefined ? "--dir" : options.envDir !== undefined ? "POINTCAST_DIR" : "the Downloads folder";
  const base = resolveSessionsBase({
    ...(options.dirFlag !== undefined ? { dirFlag: options.dirFlag } : {}),
    ...(options.envDir !== undefined ? { envDir: options.envDir } : {}),
    // Only asked when neither is set: on Windows it reads the registry.
    ...(options.dirFlag === undefined && options.envDir === undefined ? { downloadsDir: deps.downloadsDir() } : {}),
  });
  const where = `Sessions folder (${source}): ${base}`;

  if (!(await deps.isDirectory(base))) {
    if (source !== "the Downloads folder") {
      return {
        id: "sessions",
        status: "fail",
        summary: `${where} does not exist`,
        fix: `Point ${source} at an existing folder: the pointcast folder where your recordings are saved.`,
      };
    }
    return {
      id: "sessions",
      status: "warn",
      summary: `${where} does not exist yet: no recordings so far`,
      fix:
        "Record one with the extension: it lands here (or in your agent's MCP server's folder). If Chrome saves " +
        "downloads elsewhere (chrome://settings/downloads), set POINTCAST_DIR to the pointcast folder there.",
    };
  }

  let sessions: SessionDirs;
  try {
    sessions = await deps.listSessions(base);
  } catch (error) {
    // listSessionDirs's messages already say what is wrong and what to do.
    return { id: "sessions", status: "warn", summary: `${where} has no recordings`, fix: (error as Error).message };
  }
  const count = sessions.dirs.length;
  const newest = path.basename(sessions.dirs[0]!);
  const check: DoctorCheck = {
    id: "sessions",
    status: "ok",
    summary: `${where}: ${count} ${count === 1 ? "session" : "sessions"}, newest ${newest}`,
  };
  if (sessions.skippedNewer.length > 0) {
    const n = sessions.skippedNewer.length;
    return {
      ...check,
      status: "warn",
      summary: `${check.summary}; ${n} newer ${n === 1 ? "folder has" : "folders have"} no session.json (${sessions.skippedNewer.join(", ")})`,
      fix:
        'Chrome saved those recordings elsewhere: turn off "Ask where to save each file before downloading" in ' +
        "chrome://settings/downloads, or keep your agent's pointcast MCP server running so recordings go straight to it.",
    };
  }
  return check;
}

async function checkReceiver(deps: DoctorDependencies): Promise<DoctorCheck> {
  const at = `${HANDOFF_HOST}:${HANDOFF_PORT}`;
  const probe = await deps.probeReceiver();
  switch (probe.kind) {
    case "pointcast": {
      if (probe.protocol !== HANDOFF_PROTOCOL) {
        return {
          id: "receiver",
          status: "warn",
          summary: `MCP server: pointcast ${probe.version} on ${at} speaks handoff protocol ${probe.protocol}, this CLI speaks ${HANDOFF_PROTOCOL}`,
          fix: "Update pointcast and the extension to the same version, then restart your coding agent.",
        };
      }
      const order = compareVersions(probe.version, deps.version);
      const shared =
        "Each agent session starts its own pointcast MCP server: one receives, the others wait for the port, " +
        "and all of them read the same sessions folder, so every session gets the recordings.";
      return {
        id: "receiver",
        status: "ok",
        summary: `MCP server: pointcast ${probe.version} is receiving recordings on ${at}${order === 0 ? "" : ` (this CLI is ${deps.version})`}`,
        note:
          order < 0
            ? `${shared} That one is older: probably an agent session started before you updated. It still works; ` +
              `close the agent sessions started before the update (or restart them) so ${deps.version} receives.`
            : shared,
      };
    }
    case "other":
      return {
        id: "receiver",
        status: "warn",
        summary: `MCP server: another program holds ${at} (${probe.detail})`,
        fix:
          "Recordings go to Chrome's downloads instead of your agent. Close the program using that port " +
          "(for example: netstat -ano | findstr 20547 on Windows, lsof -i :20547 elsewhere).",
      };
    case "nobody":
      return {
        id: "receiver",
        status: "warn",
        summary: `MCP server: nobody is receiving recordings on ${at}`,
        fix:
          "Recordings go to Chrome's downloads for now. To send them straight to your coding agent, add pointcast's " +
          "MCP server to it (npx pointcast --help, README: MCP server) and keep the agent open while you record.",
      };
  }
}

function checkTranscription(deps: DoctorDependencies): DoctorCheck {
  if (deps.transformersInstalled()) {
    return { id: "transcription", status: "ok", summary: "Local transcription: @huggingface/transformers is installed" };
  }
  return {
    id: "transcription",
    status: "warn",
    summary: "Local transcription: @huggingface/transformers is not installed (only needed to transcribe on this machine)",
    fix:
      "The extension already transcribes in the browser. To transcribe here too (transcribe, process --force): " +
      "npm install -g pointcast @huggingface/transformers, or use --engine openai.",
  };
}

function checkClipboard(deps: DoctorDependencies): DoctorCheck {
  const found = LINUX_CLIPBOARD_TOOLS.find((tool) => deps.onPath(tool));
  if (found) return { id: "clipboard", status: "ok", summary: `Clipboard: ${found}` };
  return {
    id: "clipboard",
    status: "warn",
    summary: `Clipboard: none of ${LINUX_CLIPBOARD_TOOLS.join(", ")} is installed, so process cannot copy the spec`,
    fix: "Install wl-clipboard (Wayland) or xclip (X11), e.g. sudo apt install wl-clipboard xclip; session.md is written either way.",
  };
}

async function checkVersion(online: boolean, deps: DoctorDependencies): Promise<DoctorCheck> {
  if (!online) return { id: "version", status: "ok", summary: `pointcast ${deps.version} (--online compares it with npm)` };
  const latest = await deps.latestNpmVersion();
  if (latest === undefined) {
    return {
      id: "version",
      status: "warn",
      summary: `pointcast ${deps.version}; could not ask npm for the latest version`,
      fix: "Check the connection (or a proxy), or see https://www.npmjs.com/package/pointcast.",
    };
  }
  if (compareVersions(deps.version, latest) >= 0) {
    return { id: "version", status: "ok", summary: `pointcast ${deps.version} (latest on npm: ${latest})` };
  }
  return {
    id: "version",
    status: "warn",
    summary: `pointcast ${deps.version} is older than the latest on npm, ${latest}`,
    fix: "npm install -g pointcast@latest (npx pointcast@latest for one run), and update the extension from the releases.",
  };
}

export async function runDoctor(options: DoctorOptions, deps: DoctorDependencies): Promise<DoctorReport> {
  const checks = [
    checkNode(deps.nodeVersion),
    await checkSessions(options, deps),
    await checkReceiver(deps),
    checkTranscription(deps),
    ...(deps.platform === "linux" ? [checkClipboard(deps)] : []),
    await checkVersion(options.online, deps),
  ];
  return { version: deps.version, ok: checks.every((check) => check.status !== "fail"), checks };
}

const LABELS: Record<CheckStatus, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

/** Plain text for a terminal: one line per check, its fix indented under it. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`pointcast doctor (${report.version})`, ""];
  for (const check of report.checks) {
    lines.push(`${LABELS[check.status]}  ${check.summary}`);
    if (check.fix) lines.push(`      fix: ${check.fix}`);
    if (check.note) lines.push(`      note: ${check.note}`);
  }
  const failed = report.checks.filter((check) => check.status === "fail").length;
  const warned = report.checks.filter((check) => check.status === "warn").length;
  lines.push("");
  if (failed > 0) lines.push(`${failed} ${failed === 1 ? "problem stops" : "problems stop"} pointcast from working: fix ${failed === 1 ? "it" : "them"} first.`);
  else if (warned > 0) lines.push(`pointcast works; ${warned} optional ${warned === 1 ? "part is" : "parts are"} not set up.`);
  else lines.push("Everything works.");
  return lines.join("\n");
}
