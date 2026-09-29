// Recognizes a fixture WAV (fake mic) with Chrome's on-device SpeechRecognition and saves the event log.
//   node run.mjs --where page|offscreen --source mic|track --wav es-short.wav [--headed] [--no-install] [--cloud]
//               [--until 30000] [--no-restart] [--netlog]
// Output: results/<where>-<source>-<wav>.json  ({ meta, log, net })
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { chromium, CHROME, PROFILE, HERE, REPO, serve, fakeAudioArgs } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const where = opt("--where", "page");
const source = opt("--source", "mic");
const wav = opt("--wav", "es-short.wav");
const untilMs = Number(opt("--until", wav.includes("2min") ? 175000 : 30000));
const headed = args.includes("--headed");
const local = !args.includes("--cloud");
const netlog = path.join(os.tmpdir(), "pc-speech-netlog.json");
if (existsSync(netlog)) rmSync(netlog);

const launchArgs = [...fakeAudioArgs(wav), "--window-size=400,300", "--window-position=0,0"];
if (process.env.CHROME_LOG) launchArgs.push("--enable-logging", "--v=0", `--vmodule=${process.env.CHROME_LOG === "1" ? "*speech*=2,*soda*=2" : process.env.CHROME_LOG}`);
if (args.includes("--offline")) launchArgs.push("--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost", "--proxy-server=direct://");
if (args.includes("--netlog")) launchArgs.push(`--log-net-log=${netlog}`, "--net-log-capture-mode=Default");
if (where === "offscreen") {
  // Branded Chrome ignores --load-extension since 137; load it over CDP instead (Extensions.loadUnpacked).
  launchArgs.push("--enable-unsafe-extension-debugging");
}

const { server, origin } = await serve();
let ctx;
let rawChrome = null;
if (args.includes("--raw")) {
  // chrome.exe with only our switches (none of Playwright's defaults), driven over CDP.
  const port = 9339;
  rawChrome = spawn(
    CHROME,
    [
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...(headed ? [] : ["--headless"]),
      ...launchArgs,
      ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(" ") : []), // for bisecting Playwright's defaults
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let browser;
  for (let i = 0; i < 50 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 200));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  ctx = browser.contexts()[0];
  const close = ctx.close.bind(ctx);
  ctx.close = async () => {
    await browser.close().catch(() => {});
    rawChrome.kill();
  };
} else {
  ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: !headed,
    args: launchArgs,
    ignoreDefaultArgs: process.env.PW_IGNORE === "ALL" ? true : process.env.PW_IGNORE ? process.env.PW_IGNORE.split(" ") : ["--disable-extensions", ...(process.env.KEEP_PW_DEFAULTS ? [] : ["--disable-component-update", "--disable-field-trial-config", "--disable-background-networking"])],
  });
}
const started = Date.now();

/** The context the probe runs in: the page itself, or the offscreen document's frame. */
let target;
let installPage = ctx.pages()[0] ?? (await ctx.newPage());
if (where === "page") {
  await installPage.goto(origin + "/");
  target = installPage;
} else {
  // Build the extension in %TEMP% (probe.js + fixture audio next to it), load it over CDP.
  const extDir = path.join(os.tmpdir(), "pc-speech-ext");
  rmSync(extDir, { recursive: true, force: true });
  mkdirSync(path.join(extDir, "audio"), { recursive: true });
  for (const f of readdirSync(path.join(HERE, "ext"))) copyFileSync(path.join(HERE, "ext", f), path.join(extDir, f));
  copyFileSync(path.join(HERE, "probe.js"), path.join(extDir, "probe.js"));
  if (source.startsWith("file:")) copyFileSync(path.join(REPO, "dev", "fixtures", "audio", source.slice(5)), path.join(extDir, "audio", source.slice(5)));
  const cdp = await ctx.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: extDir });
  // The extension's own page (Pointcast's popup/side panel) gets the user gesture for install().
  if (args.includes("--autoinstall")) {
    await installPage.goto(`chrome-extension://${id}/page.html?autoinstall`);
    await installPage.waitForFunction(() => globalThis.autoInstall);
    console.log("offscreen install() without any gesture:", JSON.stringify(await installPage.evaluate(() => globalThis.autoInstall)));
    await ctx.close();
    server.close();
    process.exit(0);
  }
  await installPage.goto(`chrome-extension://${id}/page.html`);
  target = installPage;
}
await target.waitForFunction(() => globalThis.probeReady);
const meta = { where, source, wav, local, chrome: await target.evaluate(() => navigator.userAgent), headed };
meta.availableBefore = await target.evaluate(() => SpeechRecognition.available({ langs: ["es-ES"], processLocally: true }));
if (where === "offscreen") {
  // Before any install() with a gesture: what the offscreen document sees, and install() from there (no gesture).
  meta.offscreenApi = await target.evaluate(() => offscreen("api"));
  meta.offscreenInstall = await target.evaluate(() => offscreen("install"));
}
if (local && !args.includes("--no-install")) {
  meta.install = await target.evaluate((l) => probe.install(l), opt("--install-langs", "es-ES").split(",")); // evaluate() carries a user gesture
  meta.availableAfter = await target.evaluate(() => SpeechRecognition.available({ langs: ["es-ES"], processLocally: true }));
}

if (where === "offscreen") meta.offscreenApiAfter = await target.evaluate(() => offscreen("api"));
const cpuBefore = cpuSeconds();
const t0 = Date.now();
const result = await target.evaluate(
  ([w, o]) => (w === "offscreen" ? offscreen("recognize", o) : probe.recognize(o)),
  [where,
  { source, untilMs, restart: !args.includes("--no-restart"), local, lang: "es-ES", ...JSON.parse(opt("--opts", "{}")) }],
);
meta.wallMs = Date.now() - t0;
meta.cpu = cpuDelta(cpuBefore, cpuSeconds());
await ctx.close();
server.close();

let net = null;
if (args.includes("--netlog") && existsSync(netlog)) net = summarizeNetlog(readFileSync(netlog, "utf8"));
mkdirSync(path.join(HERE, "results"), { recursive: true });
const out = path.join(HERE, "results", `${where}-${source.replace(/:.*/, "")}-${path.basename(wav).replace(".wav", "")}${local ? "" : "-cloud"}.json`);
writeFileSync(out, JSON.stringify({ meta, net, ...result }, null, 1));
const finals = result.log.filter((e) => e.type === "result").flatMap((e) => e.results.filter((r) => r.final).map((r) => r.text));
console.log(JSON.stringify(meta, null, 1));
console.log("sessions:", result.sessions, "errors:", JSON.stringify(result.log.filter((e) => e.type === "error" || e.type === "startThrow")));
console.log("finals:", finals.join(" | "));
if (net) console.log("net:", JSON.stringify(net));
console.log("->", out);

/** CPU seconds of every chrome.exe launched with this profile (all processes, incl. the speech utility). */
function cpuSeconds() {
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*pc-speech-*' } | ForEach-Object { $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $matches[1] } else { 'browser' }; $u = if ($_.CommandLine -match '--utility-sub-type=([A-Za-z.]+)') { $matches[1] } else { '' }; [pscustomobject]@{ id=$_.ProcessId; type=$t; sub=$u; cpu=($_.KernelModeTime + $_.UserModeTime)/1e7 } } | ConvertTo-Json -Compress`;
  try {
    return [JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8" }) || "[]")].flat();
  } catch {
    return [];
  }
}
function cpuDelta(a, b) {
  const before = new Map(a.map((p) => [p.id, p.cpu]));
  const rows = b.map((p) => ({ type: p.sub ? `${p.type}:${p.sub}` : p.type, cpu: p.cpu - (before.get(p.id) ?? 0) }));
  const byType = {};
  for (const r of rows) byType[r.type] = Math.round(((byType[r.type] ?? 0) + r.cpu) * 10) / 10;
  return byType;
}

/** Hosts contacted according to the net log (URL requests and socket connects), with counts. */
function summarizeNetlog(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = JSON.parse(text.replace(/,\s*$/, "") + "]}"); // log cut short at close
  }
  const hosts = {};
  for (const e of json.events ?? []) {
    const url = e.params?.url ?? e.params?.host;
    if (!url || typeof url !== "string") continue;
    let host = url;
    try {
      host = new URL(url.includes("://") ? url : `x://${url}`).host;
    } catch {}
    hosts[host] = (hosts[host] ?? 0) + 1;
  }
  return hosts;
}
