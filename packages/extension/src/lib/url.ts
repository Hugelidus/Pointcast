/**
 * URLs end up in session.json and in the Markdown the agent reads, so secrets carried in
 * query strings (magic-link tokens, OAuth codes, signed-URL signatures) must be removed.
 * Names are matched loosely on purpose: redacting "?zipcode=" by mistake costs nothing,
 * leaking "?access_token=" does.
 */
const SECRET_PARAM = /token|key|secret|pass|auth|session|sig|code|otp|jwt|nonce|state|credential/i;

export const REDACTED = "REDACTED";

/** A JSON Web Token: its header is base64url JSON, which always starts with "eyJ" ('{"'). */
const JWT = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const TOKEN_CHARSET = /^[A-Za-z0-9_-]+$/;
const MIN_TOKEN_LENGTH = 16;
const MIN_CLASS_CHANGES = 5;

function charClass(char: string): "lower" | "upper" | "digit" | "other" {
  if (char >= "a" && char <= "z") return "lower";
  if (char >= "A" && char <= "Z") return "upper";
  if (char >= "0" && char <= "9") return "digit";
  return "other";
}

/**
 * True for values that look like a secret wherever they appear: a JWT, or a long random-looking
 * string. Frameworks put reset and invite tokens in the path (Django "/reset/<uid>/<token>/",
 * Laravel "/reset-password/{token}"), where no parameter name announces them.
 *
 * "Random-looking" = at least 16 base64url/hex characters with letters and digits, switching
 * between lowercase, uppercase and digits at least 5 times. Readable slugs rarely do that
 * ("getting-started-2024" switches once), random tokens almost always do. Record ids such as
 * UUIDs are redacted too; the route shape ("/orders/REDACTED") still tells the agent the page.
 */
export function looksLikeSecret(value: string): boolean {
  if (JWT.test(value)) return true;
  if (value.length < MIN_TOKEN_LENGTH || !TOKEN_CHARSET.test(value)) return false;
  if (!/[0-9]/.test(value) || !/[A-Za-z]/.test(value)) return false;
  let changes = 0;
  for (let i = 1; i < value.length; i++) {
    const before = charClass(value.charAt(i - 1));
    const after = charClass(value.charAt(i));
    if (before !== "other" && after !== "other" && before !== after) changes++;
  }
  return changes >= MIN_CLASS_CHANGES;
}

/** Redacts a query string without the leading "?"; returns undefined when nothing matched. */
function redactQuery(query: string): string | undefined {
  const entries = Array.from(new URLSearchParams(query));
  const isSecret = ([name, value]: [string, string]) => SECRET_PARAM.test(name) || looksLikeSecret(value);
  if (!entries.some(isSecret)) return undefined;
  // Rebuilt in the original order, so the URL still reads like the one in the address bar.
  const redacted = entries.map(([name, value]): [string, string] => [name, isSecret([name, value]) ? REDACTED : value]);
  return new URLSearchParams(redacted).toString();
}

/** Replaces secret-looking path segments; the host and scheme never match (they contain ':' or '.'). */
function redactPath(path: string): string {
  return path.replace(/[^/]+/g, (segment) => (looksLikeSecret(segment) ? REDACTED : segment));
}

/** Replaces the password in "scheme://user:password@host/…" when present. */
function redactUserInfo(head: string): string {
  try {
    const url = new URL(head);
    if (!url.password) return head;
    url.password = REDACTED;
    return url.href;
  } catch {
    return head; // relative URL: no user-info possible
  }
}

/**
 * Returns `href` with secrets replaced by REDACTED: values of secret-looking query parameters,
 * token-shaped values anywhere (path segments, query values, hash routes), fragments shaped
 * like query strings (OAuth implicit flow: "#access_token=…") and user-info passwords.
 * Works on absolute and relative URLs. Parts without secrets are returned unchanged, byte for
 * byte, so URLs stay comparable across events.
 */
export function redactUrl(href: string): string {
  const hashAt = href.indexOf("#");
  const beforeHash = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const head = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const search = queryAt < 0 ? "" : beforeHash.slice(queryAt);

  const redactedSearch = search === "" ? undefined : redactQuery(search.slice(1));
  // "#a=1&b=2" is a query-shaped fragment; "#/reset/<token>" is a client-side route.
  const redactedHash = hash.includes("=") ? redactQuery(hash.slice(1)) : undefined;
  const hashResult = redactedHash === undefined ? redactPath(hash) : `#${redactedHash}`;

  return (
    redactPath(redactUserInfo(head)) +
    (redactedSearch === undefined ? search : `?${redactedSearch}`) +
    hashResult
  );
}
