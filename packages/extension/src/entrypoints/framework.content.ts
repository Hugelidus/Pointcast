import { defineContentScript } from "wxt/utils/define-content-script";
import { LOCAL_HOST_MATCHES } from "../hosts";
import { installComponentBridge } from "../lib/framework-main";

/**
 * Runs in the page's MAIN world, where framework dev data on DOM nodes (Vue, Svelte, React) is
 * visible; the capture content script runs in the isolated world and cannot see it. This script
 * only answers the synchronous DOM-event request described in lib/component-bridge.ts, reading
 * names and file positions on demand; it holds no state and talks to no extension API (MAIN-world
 * scripts have none).
 *
 * document_start so the listener exists before the first gesture; the framework data itself is
 * read at request time, long after the app has rendered. Same hosts as content.ts; user-enabled
 * sites register it dynamically next to the capture script.
 */
export default defineContentScript({
  matches: [...LOCAL_HOST_MATCHES],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installComponentBridge(window);
  },
});
