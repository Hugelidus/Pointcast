// available() / install() behaviour after launch.
//   node poll-available.mjs [--headed] [--install]   polls available(), then install() from evaluate() (has a gesture)
//   node poll-available.mjs --autoinstall            install() called by the page at load, without user activation
import { chromium, CHROME, PROFILE, serve } from "./lib.mjs";

const { server, origin } = await serve();
const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: !process.argv.includes("--headed"),
  args: ["--mute-audio"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
if (process.argv.includes("--autoinstall")) {
  await page.goto(origin + "/?autoinstall");
  await page.waitForFunction(() => globalThis.autoInstall);
  // Read the promise's value without a gesture mattering: install() already ran.
  console.log(JSON.stringify(await page.evaluate(() => globalThis.autoInstall)));
} else {
  await page.goto(origin + "/");
  const t0 = Date.now();
  const avail = () => page.evaluate(() => SpeechRecognition.available({ langs: ["es-ES"], processLocally: true }));
  for (let i = 0; i < 6; i++) {
    const a = await avail();
    console.log(`${Date.now() - t0} ms: ${a}`);
    if (a === "available") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (process.argv.includes("--install")) {
    const r = await page.evaluate(() => SpeechRecognition.install({ langs: ["es-ES"], processLocally: true }));
    console.log(`install: ${r} at ${Date.now() - t0} ms`);
    console.log(`after install: ${await avail()}`);
  }
}
await ctx.close();
server.close();
