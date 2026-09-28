import { expect, test } from "./support/fixtures";
import { startFakeVite } from "./support/fake-vite";
import { PORT_DEV_SERVER } from "./support/paths";
import { readE2eRecords, readSavedSession, startFromPopup, stopFromPopup } from "./support/recorder";
import { INDICATOR } from "./support/scenario";

/**
 * Route 3 of the code pointer (offscreen/dev-server.ts, D9 note 2026-09-27): at Stop, the
 * extension reads the files of the element's chain from the page's own Vite dev server
 * (`<file>?raw`) and adds where the element's text is written to the copied spec. The dev
 * server is a stand-in (support/fake-vite.ts) that serves the playground and answers ?raw as
 * Vite does; the chain is Svelte 5 dev data set by the page's own script, as in
 * framework.spec.ts.
 */

/** The app's source as the dev server has it: "Export" is written on line 9 of the toolbar. */
const SOURCES: Record<string, string> = {
  "src/lib/Toolbar.svelte": [
    "<script>",
    '  import { Button } from "ui-kit";',
    "  let { rows } = $props();",
    "  const exportRows = () => download(rows);",
    "</script>",
    "",
    '<div class="toolbar">',
    '  <Button variant="primary" onclick={exportRows}>',
    "    Export",
    "  </Button>",
    "  <Button onclick={() => (rows = [])}>Delete</Button>",
    "</div>",
    "",
  ].join("\n"),
  "src/routes/orders/+page.svelte": `${"<!-- orders page -->\n".repeat(20)}<Toolbar {rows} />\n`,
};

test("Stop resolves the code pointer from the page's Vite dev server, and the copied spec says where the text is written", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  const vite = await startFakeVite(PORT_DEV_SERVER, SOURCES);
  try {
    const app = await context.newPage();
    await app.goto(`${vite.origin}/index.html`);
    // Svelte 5's dev data for the Export button: a library Button written in the app's Toolbar,
    // which the orders page renders.
    await app.addScriptTag({
      content: `
        const kit = "node_modules/.pnpm/ui-kit@1.0.0/node_modules/ui-kit/dist";
        document.getElementById("export-btn").__svelte_meta = {
          loc: { file: kit + "/Button.svelte", line: 12, column: 2 },
          parent: { type: "component", file: "src/lib/Toolbar.svelte", line: 8, column: 2, componentTag: "Button",
            parent: { type: "component", file: "src/routes/orders/+page.svelte", line: 21, column: 0, componentTag: "Toolbar",
              parent: null } },
        };
      `,
    });

    await startFromPopup(popup);
    await app.bringToFront();
    await expect(app.locator(INDICATOR)).toBeVisible();
    await app.locator("#export-btn").click({ modifiers: ["Alt"] });
    await expect(popup.locator("#last-event")).toHaveText("Last: button “Export”");
    const { sessionId } = await stopFromPopup(popup);

    const { session, markdown } = await readSavedSession(popup, downloadsDir, sessionId);
    // What reached the clipboard is the saved spec, laid out code-first: the instance, the
    // library it comes from, the resolved line, each with the source line read from the server.
    const copied = (await readE2eRecords(popup)).filter((record) => record.kind === "clipboard");
    expect(copied).toEqual([{ kind: "clipboard", text: markdown }]);
    expect(markdown).toContain(
      [
        "\n- [a] «Export» → code:",
        '  - used at: `src/lib/Toolbar.svelte:8` — `<Button variant="primary" onclick={exportRows}>`',
        "  - defined in: package `ui-kit`",
        '  - text at: `src/lib/Toolbar.svelte:9` — `<Button variant="primary" onclick={exportRows}> Export </Button>`',
        "  - within: `<Toolbar>` at `src/routes/orders/+page.svelte:21`",
        "  - on screen: button «Export»",
      ].join("\n"),
    );
    expect(session.events[0]?.element.resolved).toEqual([
      { kind: "text", file: "src/lib/Toolbar.svelte", line: 9, via: "dev-server", snippet: '<Button variant="primary" onclick={exportRows}> Export </Button>' },
    ]);
    expect(session.events[0]?.element.renderedBy?.map((frame) => frame.snippet)).toEqual([
      '<Button variant="primary" onclick={exportRows}>',
      "<Toolbar {rows} />",
    ]);
    // Only the lines the code pointer names reach the spec, never the rest of the source.
    expect(markdown).not.toContain("download(rows)");

    // One line in the popup's details says how it went.
    await expect(popup.locator("#result-code")).toHaveText("Code pointer: 1 location found in the source the dev server serves.");

    // Asked for: Vite's client once (is this Vite?) and the chain's two files as ?raw modules.
    const reads = vite.requests.filter((request) => request.startsWith("/@vite/") || request.endsWith("?raw"));
    expect(reads.sort()).toEqual(["/@vite/client", "/src/lib/Toolbar.svelte?raw", "/src/routes/orders/+page.svelte?raw"]);
  } finally {
    await vite.close();
  }
});
