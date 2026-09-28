// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { CapturedErrorDraft } from "@pointcast/core";
import {
  PAGE_ERRORS_CONTROL_EVENT,
  PAGE_ERRORS_REPORT_EVENT,
  PAGE_ERRORS_SESSION_KEY,
  type PageWindow,
} from "../lib/page-errors-main";
import { withoutQueryValues, withoutQueryValuesInText } from "../lib/page-errors-shared";
import { createPageErrors, sensitiveValues } from "./page-errors";

const T0 = 1_790_000_000_000;

function setup(redactPersonalData = false, html = "") {
  const dom = new JSDOM(`<body>${html}</body>`, { url: "http://localhost:5173/orders" });
  const win = dom.window as unknown as PageWindow;
  const sent: CapturedErrorDraft[] = [];
  const commands: unknown[] = [];
  win.addEventListener(PAGE_ERRORS_CONTROL_EVENT, (event) => commands.push((event as CustomEvent).detail));
  const errors = createPageErrors(win, { send: (draft) => sent.push(draft), redactPersonalData });
  const report = (value: unknown) =>
    win.dispatchEvent(new win.CustomEvent(PAGE_ERRORS_REPORT_EVENT, { detail: typeof value === "string" ? value : JSON.stringify(value) }));
  return { win, sent, commands, errors, report };
}

describe("createPageErrors (isolated half, D13)", () => {
  it("turns the MAIN-world hook on and off, with the tab's flag for pages loaded meanwhile", () => {
    const { win, commands, errors } = setup();
    errors.start(T0);
    errors.start(T0);
    expect(commands).toEqual(["start"]);
    expect(win.sessionStorage.getItem(PAGE_ERRORS_SESSION_KEY)).toBe("1");
    errors.stop();
    expect(commands).toEqual(["start", "stop"]);
    expect(win.sessionStorage.getItem(PAGE_ERRORS_SESSION_KEY)).toBeNull();
  });

  it("forwards reports only while started, from t0 on, and drops malformed ones", () => {
    const { sent, errors, report } = setup();
    report({ kind: "error", message: "before start", at: T0 + 1 });
    errors.start(T0);
    report({ kind: "error", message: "before t0", at: T0 - 1 });
    report({ kind: "nonsense", message: "x", at: T0 + 1 });
    report("{not json");
    report({ kind: "error", message: "x".repeat(9000), at: T0 + 1 });
    report({ kind: "console-error", message: "Export failed", source: "src/api.ts:12:3", at: T0 + 5 });
    errors.stop();
    report({ kind: "error", message: "after stop", at: T0 + 9 });
    expect(sent).toEqual([{ kind: "console-error", message: "Export failed", source: "src/api.ts:12:3", at: T0 + 5 }]);
  });

  it("always strips query values from URLs in messages and request paths, and token-shaped segments", () => {
    const { sent, errors, report } = setup();
    errors.start(T0);
    report({
      kind: "console-error",
      message: "GET http://localhost:5173/api/me?session=s3cr3t&x=1#frag failed",
      at: T0 + 1,
    });
    report({
      kind: "network",
      message: "POST /reset/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig?code=42 → 500",
      request: { method: "POST", url: "/reset/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig?code=42", status: 500 },
      at: T0 + 2,
    });
    expect(sent.map((d) => d.message)).toEqual([
      "GET http://localhost:5173/api/me?session&x failed",
      "POST /reset/REDACTED?code → 500",
    ]);
    expect(sent[1]?.request).toEqual({ method: "POST", url: "/reset/REDACTED?code", status: 500 });
  });

  it("redacts personal data on an enabled site, not on a local dev host", () => {
    const report = { kind: "console-error", message: "No account for ana@example.com (+34 612 345 678)", at: T0 + 1 };
    const local = setup(false);
    local.errors.start(T0);
    local.report(report);
    const remote = setup(true);
    remote.errors.start(T0);
    remote.report(report);
    remote.report({
      kind: "network",
      message: "x",
      request: { method: "GET", url: "/customers/ana@example.com/orders", status: 404 },
      at: T0 + 2,
    });
    expect(local.sent[0]?.message).toBe("No account for ana@example.com (+34 612 345 678)");
    expect(remote.sent.map((d) => d.message)).toEqual([
      "No account for [redacted] ([redacted])",
      "GET /customers/[redacted]/orders → 404",
    ]);
  });

  it("never lets the value of a sensitive field through, even when the app logs it", () => {
    const { win, sent, errors, report } = setup(
      false,
      '<input type="password" id="pw"><input id="api" data-sensitive><input id="name">',
    );
    (win.document.getElementById("pw") as HTMLInputElement).value = "CANARY-7391";
    (win.document.getElementById("api") as HTMLInputElement).value = "tok-4242";
    (win.document.getElementById("name") as HTMLInputElement).value = "Jane";
    errors.start(T0);
    report({
      kind: "console-error",
      message: "login failed for Jane with CANARY-7391 and tok-4242",
      stack: ["submit (src/login.ts:3:1)"],
      at: T0 + 1,
    });
    expect(sent[0]?.message).toBe("login failed for Jane with [redacted] and [redacted]");
    expect(JSON.stringify(sent)).not.toContain("CANARY-7391");
    expect(sensitiveValues(win.document, "data-sensitive")).toEqual(["CANARY-7391", "tok-4242"]);
  });
});

describe("query values", () => {
  it.each([
    ["/api/orders?status=open&token=abc#top", "/api/orders?status&token"],
    ["/api/orders?", "/api/orders"],
    ["/api/orders#x", "/api/orders"],
    ["api.example.com/v1?a", "api.example.com/v1?a"],
  ])("withoutQueryValues(%j)", (url, expected) => {
    expect(withoutQueryValues(url)).toBe(expected);
  });

  it("strips them in free text", () => {
    expect(withoutQueryValuesInText("fetch /x?email=a@b.c&page=2 failed: see https://h/p#k")).toBe(
      "fetch /x?email&page failed: see https://h/p",
    );
  });
});
