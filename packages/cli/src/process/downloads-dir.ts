import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
 *
 * On Linux, localized desktops name it in the user's language (~/Descargas, ~/Téléchargements):
 * xdg-user-dirs records it as XDG_DOWNLOAD_DIR in $XDG_CONFIG_HOME/user-dirs.dirs, and Chrome
 * saves there, so read it too.
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
  /** A text file's content, or undefined when it cannot be read (user-dirs.dirs on Linux). */
  readTextFile: (file: string) => string | undefined;
}

function readTextFile(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
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

/**
 * XDG_DOWNLOAD_DIR from a user-dirs.dirs file, as xdg-user-dirs writes it: a shell assignment of
 * a double-quoted "$HOME/<path>" or absolute "/<path>", with backslash escapes. Undefined when the
 * line is missing or malformed, so the caller falls back to ~/Downloads. The last valid line wins,
 * as when the shell sources the file.
 */
export function parseXdgDownloadDir(content: string, homeDir: string): string | undefined {
  let found: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*XDG_DOWNLOAD_DIR\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[1]!;
    const doubleQuoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
    const singleQuoted = /^'([^']*)'$/.exec(value);
    if (doubleQuoted) value = doubleQuoted[1]!.replace(/\\(.)/g, "$1");
    else if (singleQuoted) value = singleQuoted[1]!;
    else if (/["'\s\\]/.test(value)) continue;
    const home = /^\$(?:HOME|\{HOME\})(?=\/|$)/.exec(value);
    if (home) value = homeDir + value.slice(home[0].length);
    // Anything else ($XDG_…, a relative path, a leftover variable) cannot be trusted.
    if (!path.posix.isAbsolute(value) || value.includes("$")) continue;
    found = path.posix.normalize(value).replace(/(.)\/$/, "$1");
  }
  return found;
}

/** Where xdg-user-dirs keeps user-dirs.dirs: $XDG_CONFIG_HOME, or ~/.config when unset or relative. */
function userDirsFile(env: Record<string, string | undefined>, homeDir: string): string {
  const configHome = env.XDG_CONFIG_HOME;
  const base = configHome && path.posix.isAbsolute(configHome) ? configHome : path.posix.join(homeDir, ".config");
  return path.posix.join(base, "user-dirs.dirs");
}

export function downloadsDir(deps: Partial<DownloadsDirDependencies> = {}): string {
  const { platform = process.platform, env = process.env, homeDir = homedir() } = deps;
  const fallback = path.join(homeDir, "Downloads");
  if (platform === "darwin") return fallback;
  if (platform !== "win32") {
    // Linux and the BSDs, where Chrome follows xdg-user-dirs.
    const content = (deps.readTextFile ?? readTextFile)(userDirsFile(env, homeDir));
    return (content === undefined ? undefined : parseXdgDownloadDir(content, homeDir)) ?? fallback;
  }
  const output = (deps.queryRegistry ?? queryRegistry)(USER_SHELL_FOLDERS, DOWNLOADS_FOLDER_ID);
  const raw = output === undefined ? undefined : parseRegistryValue(output, DOWNLOADS_FOLDER_ID);
  if (raw === undefined) return fallback;
  const expanded = expandWindowsVariables(raw, env);
  // An unexpanded variable means the path cannot be trusted; the default is a better guess.
  return expanded.includes("%") ? fallback : expanded;
}
