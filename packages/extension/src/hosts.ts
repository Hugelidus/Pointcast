/**
 * Local development hosts where pointcast runs (D8). Used for the content script
 * `matches` and for `host_permissions`, so the extension never touches other sites.
 *
 * A pattern without a port matches every port, which is what a dev server needs
 * (5173, 3000, 8080, ...). Verified by dev/e2e/hosts.spec.ts on ports 5511 and 5512.
 * `*.localhost` also matches plain `localhost`; it is listed explicitly for readability.
 * `*://` means http and https.
 */
export const LOCAL_HOST_MATCHES: readonly string[] = [
  "*://localhost/*",
  "*://*.localhost/*",
  "*://127.0.0.1/*",
  "*://[::1]/*",
  "*://*.test/*",
];

/** The host part of each pattern above ("*.localhost", "[::1]", ...): for matching and for messages. */
export const LOCAL_HOSTS: readonly string[] = LOCAL_HOST_MATCHES.map((pattern) => {
  const match = /^\*:\/\/([^/]+)\/\*$/.exec(pattern);
  if (!match?.[1]) throw new Error(`unsupported host pattern: ${pattern}`);
  return match[1];
});

/**
 * Whether `url` is on a local development host, read the way Chrome reads LOCAL_HOST_MATCHES:
 * http or https, any port, and for `*.` patterns the host itself or any subdomain.
 * `undefined` (a tab whose URL the extension may not see: file://, chrome://, remote sites) is not.
 */
export function isLocalDevUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  // hostname is lowercased, and keeps the brackets of an IPv6 address ("[::1]").
  const host = parsed.hostname;
  return LOCAL_HOSTS.some((pattern) =>
    pattern.startsWith("*.") ? host === pattern.slice(2) || host.endsWith(pattern.slice(1)) : host === pattern,
  );
}
