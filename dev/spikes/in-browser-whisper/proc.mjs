/**
 * Process etiquette and measurement for the spike's Chromium launches (Windows).
 *
 * A launch is found by a marker switch on its command line (Chromium ignores unknown switches):
 * the browser process carries it, and its children are found through ParentProcessId.
 */
import { execFileSync, spawn } from "node:child_process";
import { statfsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

export function newMarker() {
  return `--pcws-run=${randomUUID()}`;
}

export function freeDiskMB() {
  const s = statfsSync(path.parse(os.tmpdir()).root);
  return Math.round((s.bavail * s.bsize) / 2 ** 20);
}

/** PowerShell that sets $ids to the marked browser process and all its descendants. */
function treeScript(marker) {
  return `
$all = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine,PeakWorkingSetSize,PeakPageFileUsage,Priority
$root = $all | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1
$ids = @()
if ($root) {
  $ids = @($root.ProcessId); $changed = $true
  while ($changed) { $changed = $false; foreach ($p in $all) { if ($ids -notcontains $p.ProcessId -and $ids -contains $p.ParentProcessId) { $ids += $p.ProcessId; $changed = $true } } }
}`;
}

/**
 * Peak working set / peak commit of the marked launch (Win32_Process reports KB). Chromium runs the
 * page's workers (and the model) in a renderer; the GPU process matters for WebGPU.
 */
export function chromiumMemory(marker) {
  if (process.platform !== "win32") return null;
  const script = `${treeScript(marker)}
$e2e = @($all | Where-Object { $_.CommandLine -like '*pointcast-e2e-profile*' }).Count
$procs = $all | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object {
  $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $matches[1] } else { 'browser' }
  [pscustomobject]@{ type=$t; peakWorkingSetMB=[math]::Round($_.PeakWorkingSetSize/1024); peakCommitMB=[math]::Round($_.PeakPageFileUsage/1024); basePriority=$_.Priority }
}
[pscustomobject]@{ procs=@($procs); e2e=$e2e } | ConvertTo-Json -Compress -Depth 4`;
  try {
    const parsed = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim());
    const procs = [parsed.procs ?? []].flat();
    const of = (type) => procs.filter((p) => p.type === type);
    return {
      rendererPeakWorkingSetMB: Math.max(0, ...of("renderer").map((p) => p.peakWorkingSetMB)),
      rendererPeakCommitMB: Math.max(0, ...of("renderer").map((p) => p.peakCommitMB)),
      gpuProcessPeakWorkingSetMB: Math.max(0, ...of("gpu-process").map((p) => p.peakWorkingSetMB)),
      browserPeakWorkingSetMB: Math.max(0, ...of("browser").map((p) => p.peakWorkingSetMB)),
      sumOfPeaksMB: procs.reduce((s, p) => s + p.peakWorkingSetMB, 0),
      basePriorities: [...new Set(procs.map((p) => p.basePriority))],
      // Chromium processes of the repo's e2e suite alive at the end (possible CPU contention).
      e2eChromiumProcesses: parsed.e2e,
    };
  } catch (err) {
    return { error: String(err.message ?? err).slice(0, 200) };
  }
}

/**
 * Chromium sets its own child priorities (measured: the foreground renderer runs at Normal and the
 * GPU process at AboveNormal even when the browser starts at BelowNormal), so the inherited class
 * is not enough. Keeps every process of the marked launch at BelowNormal until stop().
 */
export function holdBelowNormal(marker) {
  if (process.platform !== "win32") return { stop() {} };
  const script = `
while ($true) {
${treeScript(marker)}
  foreach ($id in $ids) { try { $proc = Get-Process -Id $id -ErrorAction Stop; if ($proc.PriorityClass -ne 'BelowNormal') { $proc.PriorityClass = 'BelowNormal' } } catch {} }
  Start-Sleep -Seconds 3
}`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
  return { stop: () => child.kill() };
}
