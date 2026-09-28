// Variant A: one realistic hand-typed request per task, written by an independent `claude -p`
// writer (Sonnet, medium effort, isolated like the runs) that sees ONLY the screenshot of the page
// with the element outlined, and one sentence of what the developer wants (tasks.json `intent`).
// It never sees the source, the note typed for B/C, the spec or the ground truth.
//
//   node dev/eval/typed/write-a.mjs --out <dir>
//
// The 40-word limit is enforced by resampling the same prompt, at most 3 tries per task; the
// shortest attempt is kept, and every attempt is saved (writer-<n>.json / .md).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EVAL_DIR } from "../lib/apps.mjs";
import { runClaude, spentUsd } from "./claude.mjs";

const TYPED_DIR = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string" }, parallel: { type: "string", default: "3" } } });
if (!values.out) throw new Error("--out <dir> is required");
const OUT = path.resolve(values.out);
const config = JSON.parse(readFileSync(path.join(TYPED_DIR, "tasks.json"), "utf8"));
const template = readFileSync(path.join(EVAL_DIR, "prompt.md"), "utf8");
const MAX_WORDS = 40;

// The screenshot is sent inside the message (stream-json input, an image block), not as a file:
// a first version let the writer Read screenshot.png, and 14 of 16 writers answered without
// opening it (guessing the page). Those texts were discarded before any run (see the results).
export const writerInstruction = (intent) =>
  `You are a developer checking your own web app in the browser. The attached screenshot shows the page you are looking at; the element outlined in red is the one you want changed (the red outline is not part of the app). What you want: ${intent}.

Now type that request quickly into Claude Code, the coding agent working in this app's repository, as a developer in a hurry would. The agent cannot see your screen or the screenshot, so name the element the way you naturally would from what you see. Write it in Spanish. At most ${MAX_WORDS} words. Do not mention the red outline or the screenshot, and do not invent file names or code you cannot see. Reply with the request text only, nothing else.`;

const args = [
  "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
  "--model", "sonnet", "--effort", "medium",
  "--tools", "",
  "--permission-mode", "dontAsk", "--setting-sources", "", "--safe-mode", "--strict-mcp-config",
  "--disable-slash-commands", "--no-chrome", "--no-session-persistence", "--max-budget-usd", "1",
];
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;

async function write(task) {
  const dir = path.join(OUT, task.app, task.id, "A");
  if (existsSync(path.join(dir, "prompt.md"))) return;
  mkdirSync(dir, { recursive: true });
  // An empty folder: the writer has no tools and nothing to read anyway.
  const cwd = path.join(OUT, "work", "A-writer", task.app, task.id);
  mkdirSync(cwd, { recursive: true });
  const shot = path.join(OUT, "sessions", task.app, task.id, "screenshot.png");
  copyFileSync(shot, path.join(dir, "writer.screenshot.png"));
  const input = writerInstruction(task.intent);
  writeFileSync(path.join(dir, "writer.input.md"), input);
  const message = `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(shot).toString("base64") } },
        { type: "text", text: input },
      ],
    },
  })}\n`;
  let best;
  for (let n = 1; n <= 3; n++) {
    const { result } = await runClaude({ args, prompt: message, cwd, streamFile: path.join(dir, `writer-${n}.stream.jsonl`), outDir: OUT, label: `writer ${task.app}/${task.id} #${n}` });
    if (!result || result.is_error) continue;
    writeFileSync(path.join(dir, `writer-${n}.json`), `${JSON.stringify(result, null, 2)}\n`);
    const text = String(result.result ?? "").trim().replace(/^["«]|["»]$/g, "");
    writeFileSync(path.join(dir, `writer-${n}.md`), `${text}\n`);
    if (!best || words(text) < words(best)) best = text;
    if (words(text) <= MAX_WORDS) break;
  }
  if (!best) throw new Error(`${task.id}: no writer output`);
  writeFileSync(path.join(dir, "request.md"), `${best}\n`);
  const prompt = template.replace("{{REQUEST}}", best);
  writeFileSync(path.join(dir, "prompt.md"), prompt);
  writeFileSync(path.join(dir, "prompt.sha256"), `${createHash("sha256").update(prompt).digest("hex")}\n`);
  console.log(`${task.app}/${task.id} (${words(best)} words): ${best}`);
}

const jobs = [...config.tasks];
await Promise.all(Array.from({ length: Number(values.parallel) }, async () => {
  while (jobs.length) await write(jobs.shift());
}));
console.log(`writers done; ledger total ${spentUsd(OUT).toFixed(3)} USD`);
