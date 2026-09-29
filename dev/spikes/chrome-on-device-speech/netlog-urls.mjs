// Lists every non-localhost URL (query stripped) in the last run's net log (%TEMP%\pc-speech-netlog.json),
// flagging anything that looks like a speech endpoint.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const text = readFileSync(path.join(os.tmpdir(), "pc-speech-netlog.json"), "utf8");
let json;
try {
  json = JSON.parse(text);
} catch {
  json = JSON.parse(text.replace(/,\s*$/, "") + "]}");
}
const urls = new Map();
for (const e of json.events ?? []) {
  const u = e.params?.url;
  if (!u || u.includes("localhost") || u.startsWith("chrome")) continue;
  const k = u.split("?")[0];
  urls.set(k, (urls.get(k) ?? 0) + 1);
}
for (const [u, n] of [...urls].sort()) console.log(`${/speech|asr|soda|recogni/i.test(u) ? "SPEECH? " : ""}${n}\t${u}`);
