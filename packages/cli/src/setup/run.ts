import { formatDoctorReport, type DoctorReport } from "../doctor/doctor";
import type { AgentFinding, AgentId, AgentState, SetupAction, SetupPlan, StackHint } from "./plan";
import type { CommandRunner } from "./system";

/**
 * `pointcast setup` (D14), the acting half: shows each step of the plan exactly (the command it
 * runs, the file it writes), asks before it, does it, and ends with doctor and a summary.
 */

export type SetupMode = "ask" | "yes" | "dry-run";

export interface ModeOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  /** stdin and stdout are a terminal: someone can answer y/N. */
  interactive: boolean;
}

/** --dry-run wins; then --yes; nobody to ask (--json, no terminal) means a dry run. */
export function resolveMode(options: ModeOptions): { mode: SetupMode; reason?: string } {
  if (options.dryRun) return { mode: "dry-run", reason: "--dry-run" };
  if (options.yes) return { mode: "yes" };
  if (options.json) return { mode: "dry-run", reason: "--json without --yes" };
  if (!options.interactive) return { mode: "dry-run", reason: "no terminal to ask on: run it in a terminal, or pass --yes" };
  return { mode: "ask" };
}

export type ActionOutcome = "done" | "failed" | "declined" | "planned";

export interface AgentReport {
  id: AgentId;
  name: string;
  state: AgentState;
  detail: string;
  action?: { kind: "run"; commands: string[] } | { kind: "write"; file: string; content: string };
  outcome?: ActionOutcome;
  /** Why it failed, or what a tolerated step said (captured output, or the exit code). */
  note?: string;
}

export interface SetupReport {
  version: string;
  repo: string;
  mode: SetupMode;
  modeReason?: string;
  agents: AgentReport[];
  stack: StackHint[];
  extension: string[];
  /** Absent in a dry run, which has no side effects (doctor says hello on the handoff port). */
  doctor?: DoctorReport;
  /** false when a step failed or doctor found a problem that stops pointcast. */
  ok: boolean;
}

export interface SetupRunDependencies {
  run: CommandRunner;
  confirm: (question: string) => Promise<boolean>;
  /** Creates the folder if needed. */
  writeFile: (file: string, content: string) => Promise<void>;
  doctor: () => Promise<DoctorReport>;
  /** Text mode output, one or more lines; not called with --json. */
  print: (text: string) => void;
}

const commandLine = (step: { command: string; args: string[] }) => [step.command, ...step.args].join(" ");

function describeAction(action: SetupAction): AgentReport["action"] {
  return action.kind === "run"
    ? { kind: "run", commands: action.steps.map(commandLine) }
    : { kind: "write", file: action.file, content: action.content };
}

function actionLines(action: SetupAction, mode: SetupMode): string[] {
  const verb = mode === "dry-run" ? "would " : "";
  if (action.kind === "run") return [`    ${verb}run:`, ...action.steps.map((step) => `      ${commandLine(step)}`)];
  return [`    ${verb}write ${action.file}:`, ...action.content.trimEnd().split("\n").map((line) => `      ${line}`)];
}

async function execute(action: SetupAction, capture: boolean, deps: SetupRunDependencies): Promise<{ outcome: ActionOutcome; note?: string }> {
  if (action.kind === "write") {
    try {
      await deps.writeFile(action.file, action.content);
      return { outcome: "done" };
    } catch (error) {
      return { outcome: "failed", note: (error as Error).message };
    }
  }
  const notes: string[] = [];
  for (const step of action.steps) {
    const result = await deps.run(step, { capture });
    if (result.code === 0) continue;
    const what = `${commandLine(step)} exited with ${result.code}${result.output ? `: ${result.output}` : ""}`;
    // "Marketplace already added" is a failure of this step, not of the setup.
    if (step.mayFail) {
      notes.push(`${what} (ignored: the next step decides)`);
      continue;
    }
    return { outcome: "failed", note: [...notes, what].join("\n") };
  }
  return notes.length > 0 ? { outcome: "done", note: notes.join("\n") } : { outcome: "done" };
}

async function handleAgent(finding: AgentFinding, mode: SetupMode, json: boolean, deps: SetupRunDependencies): Promise<AgentReport> {
  const report: AgentReport = { id: finding.id, name: finding.name, state: finding.state, detail: finding.detail };
  const say = (text: string) => {
    if (!json) deps.print(text);
  };
  say(`  ${finding.name}: ${finding.detail}`);
  if (!finding.action) return report;

  report.action = describeAction(finding.action);
  say(actionLines(finding.action, mode).join("\n"));
  if (mode === "dry-run") return { ...report, outcome: "planned" };
  if (mode === "ask" && !(await deps.confirm(`  Set up pointcast in ${finding.name}?`))) {
    say("    skipped");
    return { ...report, outcome: "declined" };
  }
  const result = await execute(finding.action, json, deps);
  say(result.outcome === "done" ? "    done" : `    FAILED: ${result.note}`);
  return { ...report, ...result };
}

function summaryLines(report: SetupReport): string[] {
  const names = (predicate: (agent: AgentReport) => boolean) =>
    report.agents.filter(predicate).map((agent) => agent.name).join(", ");
  const groups: [string, string][] = [
    [report.mode === "dry-run" ? "would set up" : "set up", names((a) => a.outcome === "done" || a.outcome === "planned")],
    ["declined", names((a) => a.outcome === "declined")],
    ["FAILED", names((a) => a.outcome === "failed")],
    ["already set up", names((a) => a.state === "configured")],
    ["set up by hand", names((a) => a.state === "unreadable")],
  ];
  const parts = groups.filter(([, list]) => list !== "").map(([label, list]) => `${label}: ${list}`);
  const lines = [`Summary: ${parts.length > 0 ? parts.join("; ") : "no coding agent found (paste the spec from the clipboard, or see the README's manual install)"}.`];
  const restarted = report.agents.filter((a) => a.outcome === "done").map((a) => a.name);
  if (restarted.length > 0) lines.push(`Restart ${restarted.join(", ")} so it starts pointcast's MCP server.`);
  if (report.mode === "dry-run") lines.push(`Dry run (${report.modeReason}): nothing was changed. Run again without --dry-run (or with --yes) to do it.`);
  return lines;
}

export async function runSetup(plan: SetupPlan, options: { mode: SetupMode; modeReason?: string; json: boolean }, deps: SetupRunDependencies): Promise<SetupReport> {
  const { mode, json } = options;
  const say = (text: string) => {
    if (!json) deps.print(text);
  };
  say(`pointcast setup ${plan.version} in ${plan.repo}`);
  if (mode === "dry-run") say(`Dry run (${options.modeReason}): nothing is changed.`);

  say("\nCoding agents");
  const agents: AgentReport[] = [];
  for (const finding of plan.agents) agents.push(await handleAgent(finding, mode, json, deps));

  say("\nYour project");
  for (const hint of plan.stack) {
    say(`  ${hint.summary}`);
    for (const step of hint.steps) say(`    - ${step}`);
  }

  say("\nBrowser extension");
  for (const step of plan.extension) say(`  - ${step}`);

  let doctor: DoctorReport | undefined;
  if (mode === "dry-run") {
    say("\nLast step: pointcast doctor (not run in a dry run).");
  } else {
    doctor = await deps.doctor();
    say(`\n${formatDoctorReport(doctor)}`);
  }

  const report: SetupReport = {
    version: plan.version,
    repo: plan.repo,
    mode,
    ...(options.modeReason !== undefined ? { modeReason: options.modeReason } : {}),
    agents,
    stack: plan.stack,
    extension: plan.extension,
    ...(doctor ? { doctor } : {}),
    ok: agents.every((agent) => agent.outcome !== "failed") && (doctor?.ok ?? true),
  };
  say(`\n${summaryLines(report).join("\n")}`);
  return report;
}
