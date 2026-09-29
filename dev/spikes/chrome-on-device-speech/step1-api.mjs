// Step 1: API surface, availability and install() in installed Google Chrome.
//   node step1-api.mjs [--headed] [--install]
import { chromium, CHROME, PROFILE, serve } from "./lib.mjs";

const headed = process.argv.includes("--headed");
const { server, origin } = await serve();
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: !headed,
  args: ["--mute-audio", "--window-size=400,300", "--window-position=0,0"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(origin + "/");
await page.waitForFunction(() => globalThis.probeReady);
console.log(JSON.stringify(await page.evaluate(() => probe.api()), null, 1));
if (process.argv.includes("--install")) {
  console.log("install (no gesture):", JSON.stringify(await page.evaluate(() => probe.install())));
  await page.evaluate(() => {
    document.body.innerHTML = "<button id=b>x</button>";
    document.getElementById("b").onclick = () => {
      globalThis.__inst = probe.install();
    };
  });
  await page.click("#b"); // CDP Input.dispatchMouseEvent: a trusted click, so the page gets transient activation
  console.log("install (after trusted click):", JSON.stringify(await page.evaluate(() => globalThis.__inst)));
  console.log(JSON.stringify(await page.evaluate(() => probe.api()), null, 1));
}
await ctx.close();
server.close();
