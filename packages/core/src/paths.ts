/**
 * Normalizes a file path captured from framework dev data (`ComponentInfo.file`) or a source
 * attribute (`SourceRef.file`) so it can never leak the machine it was recorded on (D8).
 *
 * Vue, Svelte and React dev builds sometimes report the component's file as an **absolute**
 * path (e.g. `C:/Users/hugob/Desktop/my-app/src/components/LineChart.vue`), which bakes the
 * user's home directory and username into `session.json` and the rendered Markdown. A
 * `data-source`-style attribute is page-controlled input and could do the same, by accident or
 * on purpose. This runs at capture time (so the stored session never has the absolute path in
 * the first place) and again at render time (so a session recorded before this existed still
 * renders safely).
 *
 * A path is only ever shortened, never invented: an already-relative path (the common case,
 * "src/components/Toolbar.tsx") is returned unchanged.
 */

/** "C:\", "C:/" — a Windows drive letter, always treated as an absolute, machine-specific path. */
const DRIVE_LETTER = /^[a-zA-Z]:[\\/]/;
/** "file://…" — always treated as absolute, whatever it points at. */
const FILE_URL_PREFIX = /^file:\/\//i;
/** A POSIX path rooted in a home directory: "/Users/hugo/…", "/home/hugo/…". */
const HOME_PREFIX = /^\/(users|home)\//i;
/** A path segment that is itself "Users" or "home": the next segment is a username. */
const HOME_SEGMENT = /^(users|home)$/i;

/**
 * Directories that mark "here is the project", tried in this order (most specific first) so a
 * path through several of them ("…/src/components/Foo.vue") is cut at the outermost one that
 * still identifies the project root, keeping the most context.
 */
const PROJECT_MARKERS = ["src", "app", "pages", "components", "lib"];

const NODE_MODULES = "node_modules";

/** Strips a `file://` scheme (and decodes percent-escapes), leaving a plain OS-style path. */
function stripFileUrl(path: string): string {
  let rest = path.slice(path.match(FILE_URL_PREFIX)![0].length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // Malformed percent-encoding: use it as-is rather than throw on a path we are trying to sanitize.
  }
  // "file:///C:/Users/…" leaves one leading slash before the drive letter; a POSIX
  // "file:///home/…" should keep its single leading slash, which the pattern below preserves.
  return rest.replace(/^\/(?=[a-zA-Z]:)/, "");
}

/**
 * Absolute, machine-specific forms this function recognizes: a drive letter, a `file://` URL,
 * or a POSIX path rooted at a home directory. A plain rooted path with no home prefix (e.g.
 * "/app/src/Toolbar.vue", how some dev servers report a container-internal path) is treated as
 * already project-relative and left alone — it carries no user identity to strip.
 */
function isMachineAbsolute(path: string, isFileUrl: boolean): boolean {
  return isFileUrl || DRIVE_LETTER.test(path) || HOME_PREFIX.test(path);
}

/** Everything after the last `node_modules/`, so a library component reads as "package/…". */
function shortenNodeModules(path: string): string | undefined {
  const marker = `/${NODE_MODULES}/`;
  const idx = path.toLowerCase().lastIndexOf(marker);
  return idx < 0 ? undefined : path.slice(idx + marker.length);
}

/** Everything from the last occurrence of the first matching project marker onward. */
function cutAtProjectMarker(path: string): string | undefined {
  const lower = path.toLowerCase();
  for (const marker of PROJECT_MARKERS) {
    const idx = lower.lastIndexOf(`/${marker}/`);
    if (idx >= 0) return path.slice(idx + 1);
  }
  return undefined;
}

/**
 * Last-resort fallback when nothing above matched: the last 3 path segments, but never a
 * segment that is (or sits inside) a home directory — "/home/hugo/file.js" keeps "file.js",
 * not "home/hugo/file.js".
 */
function lastSegments(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const homeIdx = segments.findIndex((segment, i) => HOME_SEGMENT.test(segment) && i + 1 < segments.length);
  const safe = homeIdx >= 0 ? segments.slice(homeIdx + 2) : segments;
  const tail = safe.length > 0 ? safe.slice(-3) : segments.slice(-1);
  return tail.join("/");
}

/**
 * Normalizes one captured file path to a project-relative form (D8). Recognizes Windows drive
 * letters, `file://` URLs and POSIX home directories as absolute; anything else (including a
 * plain rooted path with no home prefix) is assumed already safe and returned unchanged.
 */
export function projectRelativePath(rawPath: string): string {
  if (!rawPath) return rawPath;
  const trimmed = rawPath.trim();
  const isFileUrl = FILE_URL_PREFIX.test(trimmed);
  const path = isFileUrl ? stripFileUrl(trimmed) : trimmed;
  const posix = path.replace(/\\/g, "/");

  if (!isMachineAbsolute(posix, isFileUrl)) return rawPath;

  const rooted = posix.replace(DRIVE_LETTER, "/");
  return shortenNodeModules(rooted) ?? cutAtProjectMarker(rooted) ?? lastSegments(rooted);
}
