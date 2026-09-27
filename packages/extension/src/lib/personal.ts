/**
 * Personal-data redaction for sites that are not the user's own local app
 * (CaptureOptions.redactPersonalData). On a real website the text around what the user points at
 * can be someone's email, phone or bank details; the agent needs the structure, not those.
 *
 * The rules err on the side of redacting: a 9-digit order number is lost too, which is the
 * right trade on a site the user does not own. Opt-in, so local dev apps keep every character.
 */

export const REDACTED_PERSONAL = "[redacted]";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Two letters, two check digits, then 11–30 letters/digits, optionally grouped by spaces. */
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;

/**
 * Nine or more digits with light separators: phone numbers ("+34 612 345 678",
 * "(555) 123-4567"), card numbers ("4111 1111 1111 1111") and account numbers.
 */
const LONG_NUMBER = /\+?\(?\d(?:[ .\-/()]{0,2}\d){8,}/g;

/**
 * A date with its hour, which LONG_NUMBER sees as 10 digits: "2026-09-27 18" of
 * "2026-09-27 18:30", "27/09/2026 18" of "27/09/2026 18:30". Timestamps in tables and logs are
 * context the agent needs, not personal data.
 */
const DATE_AND_HOUR = /^(?:\d{4}([-/.])\d{1,2}\1\d{1,2}|\d{1,2}([-/.])\d{1,2}\2\d{4}) \d{1,2}$/;

/**
 * API keys, session ids, JWT parts, hashes: long runs of word characters mixing letters and
 * digits. 24 characters keeps ordinary long words and most CSS-module class names.
 */
const TOKEN_CANDIDATE = /[A-Za-z0-9_\-+=]{24,}/g;

function isTokenLike(value: string): boolean {
  return /\d/.test(value) && /[A-Za-z]/.test(value);
}

/** `text` with emails, phone/card/IBAN-like numbers and token-like strings replaced by [redacted]. */
export function redactPersonalText(text: string): string {
  return text
    .replace(EMAIL, REDACTED_PERSONAL)
    .replace(IBAN, REDACTED_PERSONAL)
    .replace(TOKEN_CANDIDATE, (match) => (isTokenLike(match) ? REDACTED_PERSONAL : match))
    .replace(LONG_NUMBER, (match) => (DATE_AND_HOUR.test(match) ? match : REDACTED_PERSONAL));
}

/**
 * redactPersonalText for a URL that redactUrl already cleaned of secrets: an email, phone or
 * IBAN in the path or query ("/customers?email=bob%40example.com") is as personal as on the
 * page. Percent-escapes are decoded first so the rules see "bob@example.com"; a URL with
 * nothing to redact is returned unchanged, byte for byte, so URLs stay comparable.
 */
export function redactPersonalUrl(url: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url; // a malformed escape: redact what is readable
  }
  const redacted = redactPersonalText(decoded);
  return redacted === decoded ? url : redacted;
}
