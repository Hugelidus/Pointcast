/**
 * Session id = local wall-clock time of t0, "YYYY-MM-DD_HH-mm-ss".
 * Local time (not UTC) because the id is also the folder name the user sees in Downloads,
 * and it should match their clock. It sorts chronologically as plain text.
 */
export function formatSessionId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${day}_${time}`;
}

/**
 * `base`, or `base-2`, `base-3`… when that folder name is already taken.
 *
 * Why: ids have one-second resolution, so a very short session followed by a new one within
 * the same second would get the same folder, and Chrome's "uniquify" would then write
 * "audio (1).wav" into the first session's folder, where the CLI never looks. The suffix keeps
 * text order chronological ("…_18-30-05" < "…_18-30-05-2" < "…_18-30-06").
 */
export function nextFreeSessionId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
