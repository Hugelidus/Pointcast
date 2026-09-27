import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Where the browser most likely saved sessions: the user's Downloads folder.
 *
 * On Windows that is not always <home>\Downloads: the Downloads "known folder" can be moved
 * (to OneDrive, to another drive) from its Properties > Location tab. Windows records the
 * current location in the registry, so read it there. Chrome's own "Location" setting can
 * point anywhere and cannot be discovered from outside the browser; the CLI's error message
 * explains --dir / POINTCAST_DIR for that case.
 */

const USER_SHELL_FOLDERS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
/** FOLDERID_Downloads. */
const DOWNLOADS_FOLDER_ID = "{374DE290-123F-4565-9164-39C4925E467B}";

export interface DownloadsDirDependencies {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homeDir: string;
  /** Output of `reg query <key> /v <value>`, or undefined when it fails. */
  queryRegistry: (key: string, value: string) => string | undefined;
}

function queryRegistry(key: string, value: string): string | undefined {
  try {
    // windowsHide: never flash a console window on the user's screen.
    return execFileSync("reg", ["query", key, "/v", value], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  } catch {
    return undefined;
  }
}

/** The data of one value in `reg query` output ("    <name>    REG_EXPAND_SZ    <data>"). */
export function parseRegistryValue(output: string, name: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line);
    if (match?.[1]?.toLowerCase() === name.toLowerCase()) return match[2];
  }
  return undefined;
}

/** Expands Windows-style %VARIABLE% references; names are case-insensitive like on Windows. */
export function expandWindowsVariables(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key !== undefined && env[key] !== undefined ? (env[key] as string) : whole;
  });
}

export function downloadsDir(deps: Partial<DownloadsDirDependencies> = {}): string {
  const { platform = process.platform, env = process.env, homeDir = homedir() } = deps;
  const fallback = path.join(homeDir, "Downloads");
  if (platform !== "win32") return fallback;
  const output = (deps.queryRegistry ?? queryRegistry)(USER_SHELL_FOLDERS, DOWNLOADS_FOLDER_ID);
  const raw = output === undefined ? undefined : parseRegistryValue(output, DOWNLOADS_FOLDER_ID);
  if (raw === undefined) return fallback;
  const expanded = expandWindowsVariables(raw, env);
  // An unexpanded variable means the path cannot be trusted; the default is a better guess.
  return expanded.includes("%") ? fallback : expanded;
}
