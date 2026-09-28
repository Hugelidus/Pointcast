import { expect, test } from "./support/fixtures";
import { PORT_A } from "./support/paths";
import { readSavedSession, startFromPopup, stopFromPopup } from "./support/recorder";
import { INDICATOR } from "./support/scenario";

/**
 * The MAIN-world component bridge (lib/component-bridge.ts, lib/framework-main.ts) in the real
 * browser: the capture script runs in an isolated world and cannot see a framework's data on DOM
 * nodes, so the manifest's MAIN-world script reads it and hands it over through a DOM attribute.
 */
test("framework dev data set by the page's own scripts (Vue, Svelte, React) lands in component and renderedBy", async ({
  context,
  extensionPage: popup,
  downloadsDir,
}) => {
  const app = await context.newPage();
  await app.goto(`http://127.0.0.1:${PORT_A}/index.html`);
  // What each framework's dev build leaves on the DOM, set by <script>s of the page itself, so
  // they run in the page's own (MAIN) world. Paths are shaped like the real ones: absolute (Vue),
  // in node_modules or generated (Svelte), module URLs in a React 19 debug stack.
  await app.addScriptTag({
    content: `
      // Vue 3: each element points at the instance that owns it; each instance at its parent
      // and at the vnode created by the component whose template writes it (vnode.ctx).
      const src = "C:/Users/dev/Desktop/shop/src";
      const root = { type: { __file: src + "/App.vue" }, parent: null, vnode: { ctx: null } };
      const ordersPage = { type: { __name: "OrdersPage", __file: src + "/pages/OrdersPage.vue" }, parent: root, vnode: { ctx: root } };
      document.getElementById("orders-table").__vueParentComponent = {
        type: { __name: "OrdersTable", __file: "src/components/OrdersTable.vue" },
        parent: ordersPage,
        vnode: { ctx: ordersPage },
      };

      // Svelte 5: where the element is written (loc) and the stack of blocks around it.
      const kit = "node_modules/.pnpm/ui-kit@1.0.0/node_modules/ui-kit/dist";
      document.getElementById("export-btn").__svelte_meta = {
        loc: { file: kit + "/Button.svelte", line: 12, column: 2 },
        parent: { type: "component", file: "src/lib/Toolbar.svelte", line: 8, column: 4, componentTag: "Button",
          parent: { type: "render", file: kit + "/Card.svelte", line: 3, column: 0,
            parent: { type: "component", file: "src/routes/orders/+page.svelte", line: 21, column: 2, componentTag: "Toolbar",
              parent: { type: "component", file: ".svelte-kit/generated/root.svelte", line: 54, column: 18, componentTag: "Pyramid_1",
                parent: null } } } },
      };

      // React 19: the host fiber, its owners, and where each owner's JSX was created.
      const stack = (url) => {
        const error = new Error("react-stack-top-frame");
        error.stack = "Error: react-stack-top-frame\\n" +
          "    at jsxDEV (" + location.origin + "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:13)\\n" +
          "    at render (" + url + ")";
        return error;
      };
      function OrdersToolbar() {}
      function PrintButton() {}
      const toolbar = { type: OrdersToolbar, _debugOwner: null, _debugStack: stack(location.origin + "/src/pages/orders.tsx?t=1:40:7") };
      const printButton = {
        type: PrintButton,
        _debugOwner: toolbar,
        _debugStack: stack(location.origin + "/src/components/orders-toolbar.tsx?t=1:12:9"),
      };
      document.querySelector(".MuiButton-root")["__reactFiber$e2e"] = {
        type: "button",
        _debugOwner: printButton,
        return: { type: PrintButton, return: null },
      };
    `,
  });

  await startFromPopup(popup);
  await app.bringToFront();
  await expect(app.locator(INDICATOR)).toBeVisible();
  // A header cell inside the table: the bridge walks up to the element that has the component.
  await app.getByRole("columnheader", { name: "Quantity" }).click({ modifiers: ["Alt"] });
  await expect(popup.locator("#last-event")).toHaveText("Last: column header “Quantity”");
  await app.locator("#export-btn").click({ modifiers: ["Alt"] });
  await expect(popup.locator("#last-event")).toHaveText("Last: button “Export”");
  await app.getByRole("button", { name: "Print" }).click({ modifiers: ["Alt"] });
  await expect(popup.locator("#last-event")).toHaveText("Last: button “Print”");
  const { sessionId } = await stopFromPopup(popup);

  const { session } = await readSavedSession(popup, downloadsDir, sessionId);
  const [vue, svelte, react] = session.events.map((event) => event.element);
  expect(session.events).toHaveLength(3);

  expect(vue?.component).toEqual({ framework: "vue", name: "OrdersTable", file: "src/components/OrdersTable.vue" });
  // Each instance where it is written; the absolute paths are project-relative (D8).
  expect(vue?.renderedBy).toEqual([
    { component: "OrdersTable", file: "src/pages/OrdersPage.vue" },
    { component: "OrdersPage", file: "src/App.vue" },
  ]);

  expect(svelte?.component).toMatchObject({ framework: "svelte", name: "Button", line: 12, column: 3 });
  // The library's own blocks and SvelteKit's generated root are not app frames.
  expect(svelte?.renderedBy).toEqual([
    { component: "Button", file: "src/lib/Toolbar.svelte", line: 8, column: 5 },
    { component: "Toolbar", file: "src/routes/orders/+page.svelte", line: 21, column: 3 },
  ]);

  expect(react?.component).toEqual({ framework: "react", name: "PrintButton" });
  expect(react?.renderedBy).toEqual([
    { component: "PrintButton", file: "src/components/orders-toolbar.tsx" },
    { component: "OrdersToolbar", file: "src/pages/orders.tsx" },
  ]);

  // The attribute that carried the answers between the worlds is gone before the HTML is read.
  for (const element of [vue, svelte, react]) expect(element?.html).not.toContain("data-pointcast-component");
  expect(await app.locator("[data-pointcast-component]").count()).toBe(0);
});
