// node --test dev/eval/   (plain node:test: dev/eval/ is not a workspace package, so no Vitest config)
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractAnswer, gradeAnswer, summarize, toMarkdown } from "./grade.mjs";

/** The pilot's classic trap: "este botón violeta" pointed at Export, but .primary is shared with Save. */
const violet = {
  id: "export-violet",
  summary: "Export button violet",
  topic: "violet|purple|morad",
  files: ["style.css", "index.html"],
  target: "export",
  wrong: "(^|[^-\\w#])(button)?\\.primary\\b",
};
const red = { id: "header-red", summary: "", topic: "roj|red", files: ["style.css"], target: "header", wrong: "toolbar" };

const item = (request, file, target) => ({ request, file, line: 1, target, confidence: 0.9 });

test("right element in an accepted file is correct; accents and case do not matter", () => {
  const grades = gradeAnswer([item("Botón Export en VIOLETA", "./style.css", "#export-btn")], [violet]);
  assert.deepEqual(grades.map((g) => g.status), ["correct"]);
});

test("the shared style is wrong even when the item mentions the pointed element", () => {
  const [g] = gradeAnswer([item("make export violet", "style.css", "button.primary (Export)")], [violet]);
  assert.equal(g.status, "wrong");
  assert.match(g.why, /wrong construct/);
});

test("comments after the construct do not make it wrong", () => {
  const [g] = gradeAnswer([item("violet", "style.css", "button#export-btn (now styled by button.primary)")], [violet]);
  assert.equal(g.status, "correct");
});

test("lines tell apart elements with the same text", () => {
  const dup = { id: "dup", summary: "", topic: "card", files: ["Dashboard.svelte"], target: "second", lines: [133, 152] };
  assert.equal(gradeAnswer([item("remove duplicate card", "Dashboard.svelte", "ProductMetricCard Users")].map((i) => ({ ...i, line: 133 })), [dup])[0].status, "correct");
  assert.equal(gradeAnswer([item("remove duplicate card", "Dashboard.svelte", "ProductMetricCard Users")].map((i) => ({ ...i, line: 127 })), [dup])[0].status, "wrong");
});

test("hedging between the right and a wrong element is wrong; no item at all is missed", () => {
  const grades = gradeAnswer(
    [item("header red", "style.css", "header"), item("header red (maybe)", "style.css", ".toolbar")],
    [red, violet],
  );
  assert.deepEqual(grades.map((g) => g.status), ["wrong", "missed"]);
});

test("an item right for another change it also talks about does not count against this one", () => {
  const notes = { id: "notes", summary: "", topic: "remov|quit", files: ["index.html"], target: "notes" };
  const token = { id: "token", summary: "", topic: "api token|remov", files: ["index.html"], target: "api-token" };
  const grades = gradeAnswer(
    [item("Remove the Notes paragraph", "index.html", "section Order notes > p"), item("API token: remove data-sensitive", "index.html", "#api-token")],
    [notes, token],
  );
  assert.deepEqual(grades.map((g) => g.status), ["correct", "correct"]);
});

test("a file outside the accepted list is wrong; Windows separators are normalized", () => {
  assert.equal(gradeAnswer([item("violet", "src\\components\\Toolbar.tsx", "export")], [violet])[0].status, "wrong");
  assert.equal(gradeAnswer([item("violet", "playground\\index.html", "#export-btn")], [violet])[0].status, "correct");
});

test("extractAnswer prefers structured_output and falls back to JSON inside the text", () => {
  const changes = [item("a", "b", "c")];
  assert.deepEqual(extractAnswer({ structured_output: { changes } }), changes);
  assert.deepEqual(extractAnswer({ result: "Here:\n```json\n" + JSON.stringify({ changes }) + "\n```" }), changes);
  assert.equal(extractAnswer({ result: "no json" }), undefined);
});

test("summarize averages successful runs only and the table shows failures", () => {
  const usage = { inputTokens: 10, cacheCreationTokens: 1000, cacheReadTokens: 2000, outputTokens: 500, costUsd: 0.1, turns: 4, durationMs: 60000 };
  const rows = summarize([
    { app: "a", condition: "M1", ok: true, correct: 2, total: 4, usage },
    { app: "a", condition: "M1", ok: true, correct: 4, total: 4, usage: { ...usage, turns: 6 } },
    { app: "a", condition: "M1", ok: false, correct: 0, total: 4, usage },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accuracy, 0.75);
  assert.equal(rows[0].turns, 5);
  assert.equal(rows[0].failed, 1);
  assert.match(toMarkdown(rows), /\| a \| M1 \| 3 \(1 failed\) \| 2\/4, 4\/4 \| 75 % \| 3\.0 k \|/);
});
