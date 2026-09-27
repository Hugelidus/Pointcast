/**
 * Marks every element the extension injects into a page (REC indicator, highlight flash).
 * Capture ignores events inside these elements, so pointcast never records itself.
 */
export const UI_ATTRIBUTE = "data-pointcast-ui";

/** Attributes holding "file:line[:col]", checked in order on the element and its ancestors (D9). */
export const DEFAULT_SOURCE_ATTRIBUTES: readonly string[] = ["data-source"];

/** Attribute that marks an element (and its subtree) as sensitive (D8). */
export const DEFAULT_SENSITIVE_ATTRIBUTE = "data-sensitive";

/** Folder inside the browser's downloads directory where sessions are saved. */
export const SESSIONS_FOLDER = "pointcast";
