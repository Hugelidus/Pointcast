import { isLocalDevUrl, LOCAL_HOST_MATCHES } from "./hosts";

/**
 * Sites the user enabled one by one from the popup (D8 note 2026-09-27). Local dev hosts are
 * always on (manifest host_permissions); any other http(s) site needs an optional host
 * permission, which the user grants for exactly one host. The granted permissions are the only
 * record of which sites are enabled: nothing else is stored, so the list can never disagree
 * with what Chrome lets the extension do (the user can also revoke a site in Chrome's own UI).
 */

// The manifest's optional_host_permissions: every http(s) site, granted one host at a time.
// One pattern with the "*" scheme, because Chrome grants a request only when a SINGLE declared
// pattern contains it: "*://example.com/*" (what sitePattern asks for) fits in "*://*/*" but in
// neither "http://*/*" nor "https://*/*". With those two, Chrome refused every request with
// "Only permissions specified in the manifest may be requested" (found by
// e2e/enabled-site.spec.ts; D8 note 2026-09-27).
export const OPTIONAL_SITE_MATCHES: readonly string[] = ["*://*/*"];

/**
 * The match pattern pointcast asks for to enable the site of `url`: "*://example.com/*" (http
 * and https, any port, that host only, no subdomains). Undefined when the page is not a site
 * that can be enabled: local dev hosts (always on), file://, chrome://, the Web Store...
 */
export function sitePattern(url: string | undefined): string | undefined {
  if (!url || isLocalDevUrl(url)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  if (parsed.hostname === "" || parsed.hostname === "chromewebstore.google.com") return undefined;
  return `*://${parsed.hostname}/*`;
}

/** "example.com" for "*://example.com/*", for the popup. */
export function patternHost(pattern: string): string {
  return /^[^:]+:\/\/([^/]+)\//.exec(pattern)?.[1] ?? pattern;
}

// A pattern for one exact host, so not <all_urls>, a "*" host, or a "*.example.com" host.
const EXACT_HOST_PATTERN = /^[^:]+:\/\/[^/*]+\//;

/**
 * The enabled sites among the origins Chrome reports as granted (chrome.permissions.getAll):
 * everything except the manifest's local dev hosts. Deduplicated and sorted for a stable list.
 * Sites are enabled one host at a time (D8), so a wildcard grant (Chrome's own "On all sites"
 * menu) enables nothing: registering it would capture on every site, banks and webmail
 * included, while the popup, which matches exact hosts, said those pages were not captured.
 */
export function enabledSitePatterns(granted: readonly string[] | undefined): string[] {
  const sites = (granted ?? []).filter((origin) => !LOCAL_HOST_MATCHES.includes(origin) && EXACT_HOST_PATTERN.test(origin));
  return [...new Set(sites)].sort();
}

/**
 * The enabled site pattern that covers `url`, as Chrome reports it; undefined when none does.
 * Compared by host rather than by string, so a grant Chrome reports per scheme
 * ("https://example.com/*") still counts.
 */
export function enabledSiteFor(url: string | undefined, sites: readonly string[]): string | undefined {
  const pattern = sitePattern(url);
  if (pattern === undefined) return undefined;
  const host = patternHost(pattern);
  return sites.find((site) => patternHost(site) === host);
}

/** Whether `url` is on one of the enabled `sites`. */
export function isEnabledSite(url: string | undefined, sites: readonly string[]): boolean {
  return enabledSiteFor(url, sites) !== undefined;
}

/** Whether pointcast captures a page at `url`: a local dev host, or an enabled site. */
export function isCapturableUrl(url: string | undefined, sites: readonly string[]): boolean {
  return isLocalDevUrl(url) || isEnabledSite(url, sites);
}
