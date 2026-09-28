/**
 * Helpers both halves of debug capture use (D13): the MAIN-world hook (page-errors-main.ts) and
 * the isolated-world content script (content/page-errors.ts). No DOM, no extension API.
 */

/**
 * `url` without its fragment and without the values of its query parameters: the names stay, so
 * the agent sees which endpoint and which filters, never a token, an email or a search term
 * ("/api/orders?status=open&token=abc#top" → "/api/orders?status&token").
 */
export function withoutQueryValues(url: string): string {
  const [beforeHash = ""] = url.split("#", 1);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt < 0) return beforeHash;
  const names = beforeHash
    .slice(queryAt + 1)
    .split("&")
    .map((pair) => pair.split("=", 1)[0] ?? "")
    .filter((name) => name !== "");
  const path = beforeHash.slice(0, queryAt);
  return names.length > 0 ? `${path}?${names.join("&")}` : path;
}

/**
 * The same inside free text (an error message that quotes a URL): every "?name=value" and
 * "&name=value" loses its value, and "#…" right after a URL's path is dropped.
 */
export function withoutQueryValuesInText(text: string): string {
  return text
    .replace(/([?&][^\s=&#?"'<>`]{1,100})=[^\s&#"'<>`]*/g, "$1")
    .replace(/(\bhttps?:\/\/[^\s#"'<>`]*)#[^\s"'<>`]*/g, "$1");
}
