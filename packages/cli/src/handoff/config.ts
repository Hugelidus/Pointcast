import { EXTENSION_ID_PATTERN, HANDOFF_PORT, OFFICIAL_EXTENSION_IDS } from "@pointcast/core";
import { CliError } from "../errors";

/**
 * The port `pointcast mcp` receives recordings from the extension on (D11), or undefined for no
 * receiver: `--no-handoff` or POINTCAST_HANDOFF=off|0 turn it off (shared multi-user machines,
 * or users who want Chrome's downloads anyway). POINTCAST_HANDOFF_PORT is a test hook only: the
 * extension's port is fixed at build time, so any other port never hears from a real extension.
 * 0 asks the OS for a free port, which is what tests use so they never touch 20547.
 */
export function resolveHandoffPort(noHandoff: boolean, env: Record<string, string | undefined>): number | undefined {
  if (noHandoff) return undefined;
  const handoff = env.POINTCAST_HANDOFF?.trim().toLowerCase();
  if (handoff === "off" || handoff === "0") return undefined;

  const port = env.POINTCAST_HANDOFF_PORT;
  if (port === undefined || port === "") return HANDOFF_PORT;
  // Same strictness as --threads: "5542abc" is a typo, not 5542.
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) {
    throw new CliError(`POINTCAST_HANDOFF_PORT must be a port number from 0 to 65535, got "${port}".`);
  }
  return Number(port);
}

/**
 * The extension ids whose recordings the receiver accepts: the official builds, plus
 * POINTCAST_EXTENSION_IDS (comma-separated) for a fork, or a store whose id is not in
 * OFFICIAL_EXTENSION_IDS yet. Additive, so setting it never locks the official extension out.
 */
export function allowedExtensionIds(env: Record<string, string | undefined>): ReadonlySet<string> {
  const ids = new Set(OFFICIAL_EXTENSION_IDS);
  for (const entry of (env.POINTCAST_EXTENSION_IDS ?? "").split(",")) {
    const id = entry.trim();
    if (id === "") continue;
    if (!EXTENSION_ID_PATTERN.test(id)) {
      throw new CliError(
        `POINTCAST_EXTENSION_IDS: "${id}" is not an extension id (32 letters from a to p, as chrome://extensions shows it).`,
      );
    }
    ids.add(id);
  }
  return ids;
}

export interface HandoffSettings {
  /** undefined: no receiver. */
  port: number | undefined;
  allowedExtensionIds: ReadonlySet<string>;
}

/**
 * What `pointcast mcp` receives on, from --no-handoff and the environment. The receiver must never
 * cost the agent its tools (D11), so a malformed POINTCAST_HANDOFF_PORT or POINTCAST_EXTENSION_IDS
 * turns the receiver off with a line on stderr instead of stopping the server; the recordings then
 * go to Chrome's downloads, as with no server. With the receiver off, neither is read at all.
 */
export function resolveHandoffSettings(
  noHandoff: boolean,
  env: Record<string, string | undefined>,
  log: (message: string) => void,
): HandoffSettings {
  const official: ReadonlySet<string> = new Set(OFFICIAL_EXTENSION_IDS);
  try {
    const port = resolveHandoffPort(noHandoff, env);
    return port === undefined ? { port, allowedExtensionIds: official } : { port, allowedExtensionIds: allowedExtensionIds(env) };
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    log(`${error.message} Not receiving recordings from the extension; they go to Chrome's downloads.`);
    return { port: undefined, allowedExtensionIds: official };
  }
}
