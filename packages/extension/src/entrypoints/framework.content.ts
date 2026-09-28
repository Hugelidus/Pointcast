import { defineContentScript } from "wxt/utils/define-content-script";
import { LOCAL_HOST_MATCHES } from "../hosts";
import { installComponentBridge } from "../lib/framework-main";
import { installPageErrors } from "../lib/page-errors-main";

/**
 * Runs in the page's MAIN world, where framework dev data on DOM nodes (Vue, Svelte, React) and the
 * page's own errors, console and network are visible; the capture content script runs in the
 * isolated world and sees neither. MAIN-world scripts have no extension API, so this script only
 * talks to the isolated one through DOM events:
 * - the component bridge (lib/component-bridge.ts) answers a synchronous request with names and
 *   file positions read on demand, and an asynchronous one that also fetches the page's own
 *   source maps (Next.js); it holds no state between requests;
 * - debug capture (lib/page-errors-main.ts, D13) hooks the page's errors, console.error/warn,
 *   fetch and XMLHttpRequest only while a recording with that setting runs, and reports what
 *   fails.
 *
 * document_start so the listeners exist before the first gesture, and so a page loaded during a
 * recording is hooked before its first request. Same hosts as content.ts; user-enabled sites
 * register it dynamically next to the capture script.
 */
export default defineContentScript({
  matches: [...LOCAL_HOST_MATCHES],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installComponentBridge(window);
    installPageErrors(window);
  },
});
