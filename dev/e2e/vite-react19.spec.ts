import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./support/fixtures";
import { PORT_VITE_REACT, REPO_ROOT } from "./support/paths";
import { readSavedSession, startFromPopup, stopFromPopup } from "./support/recorder";
import { INDICATOR } from "./support/scenario";

/**
 * React 19 on Vite (D9 note 2026-09-29): the owner stacks' positions are in the modules Vite
 * serves, and each module carries its source map inline. After the gesture, the page's own dev
 * server is asked for the chain's modules and their lines are mapped back to the source. The
 * app is the real dev/examples/react-dashboard (React 19, Vite 8, @vitejs/plugin-react), on its
 * real dev server; SCENARIOS.md there has the lines.
 */

const EXAMPLE = path.join(REPO_ROOT, "dev", "examples", "react-dashboard");

async function startExample(port: number): Promise<{ origin: string; close: () => void }> {
  const vite = path.join(path.dirname(createRequire(path.join(EXAMPLE, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
  const child: ChildProcess = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: EXAMPLE,
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    if (child.pid !== undefined) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Not fatal: normal priority.
  }
  const origin = `http://127.0.0.1:${port}`;
  const close = () => child.kill();
  for (const deadline = Date.now() + 30_000; ; ) {
    if (child.exitCode !== null) throw new Error(`the example's dev server exited (${child.exitCode})`);
    try {
      if ((await fetch(`${origin}/`)).ok) return { origin, close };
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      close();
      throw new Error(`the example's dev server did not answer on ${origin}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

test("React 19 on Vite: the copied spec gives each file of the chain its source line", async ({ context, extensionPage: popup, downloadsDir }) => {
  const example = await startExample(PORT_VITE_REACT);
  try {
    const app = await context.newPage();
    await app.goto(`${example.origin}/`);
    const badge = app.locator(".sidebar .badge");
    await expect(badge).toHaveText("3");

    await startFromPopup(popup);
    await app.bringToFront();
    await expect(app.locator(INDICATOR)).toBeVisible();
    await badge.click({ modifiers: ["Alt"] });
    await expect(popup.locator("#last-event")).toContainText("3");
    // The lines come asynchronously, from the dev server, a few ms after the gesture (within 3 s).
    await app.waitForTimeout(2_000);
    const { sessionId } = await stopFromPopup(popup);

    const { session, markdown } = await readSavedSession(popup, downloadsDir, sessionId);
    // The source lines (dev/examples/react-dashboard/src): the badge's <span> in Sidebar.tsx:26,
    // <Sidebar> in App.tsx:12, <App /> in main.tsx:7. Before, the same files without lines.
    expect(session.events[0]?.element.component).toMatchObject({ framework: "react", name: "Sidebar", file: "src/components/Sidebar.tsx", line: 26 });
    expect(session.events[0]?.element.renderedBy).toEqual([
      { component: "Sidebar", file: "src/App.tsx", line: 12, column: 7, snippet: expect.any(String) },
      { component: "App", file: "src/main.tsx", line: 7, column: 5, snippet: expect.any(String) },
    ]);
    expect(markdown).toContain("used at: `src/App.tsx:12`");
    expect(markdown).toContain("src/components/Sidebar.tsx:26");
  } finally {
    example.close();
  }
});
