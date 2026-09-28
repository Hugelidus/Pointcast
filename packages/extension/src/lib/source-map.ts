/**
 * The one source map lookup the component bridge needs (framework-main.ts, Next.js): from a
 * position in generated code to the original file and line. Source Map v3, both plain maps and
 * index maps (`sections`, which Turbopack writes for every chunk). Nothing else of the format is
 * used: names, sourcesContent and ignore lists are not read.
 *
 * The map is page input (the page's dev server sends it), so every field is checked and a
 * malformed map gives "no position", never a throw.
 */

/** A position in the original source: `source` exactly as the map writes it, 1-based line and column. */
export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
}

interface PlainMap {
  sources: string[];
  /** Decoded lazily, once: per generated line, its segments [generatedColumn, source, line, column]. */
  lines?: number[][][];
  mappings: string;
}

interface Section {
  line: number;
  column: number;
  map: PlainMap;
}

/** A parsed map: a plain map is one section at offset 0:0. */
export interface SourceMap {
  sections: Section[];
}

/** At most this many sections of an index map are read (a page's map is page input). */
const MAX_SECTIONS = 10_000;

/** Parses a source map's JSON text; undefined when it is not a v3 map this module can read. */
export function parseSourceMap(json: string): SourceMap | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  const data = object(raw);
  if (data === undefined || data.version !== 3) return undefined;
  if (Array.isArray(data.sections)) {
    const sections: Section[] = [];
    for (const item of data.sections.slice(0, MAX_SECTIONS)) {
      const section = object(item);
      const offset = object(section?.offset);
      const map = plainMap(object(section?.map));
      if (offset === undefined || map === undefined || !isCount(offset.line) || !isCount(offset.column)) return undefined;
      sections.push({ line: offset.line, column: offset.column, map });
    }
    return { sections };
  }
  const map = plainMap(data);
  return map === undefined ? undefined : { sections: [{ line: 0, column: 0, map }] };
}

/**
 * The original position of a 1-based generated `line` and `column` (what a stack trace prints):
 * the mapping segment at or before that column on that line. Undefined when the line has no
 * segment there, or the segment names no source.
 */
export function originalPosition(map: SourceMap, line: number, column: number): OriginalPosition | undefined {
  const line0 = line - 1;
  const column0 = column - 1;
  if (!isCount(line0) || !isCount(column0)) return undefined;
  // The last section that starts at or before the position (sections are in order, by the spec).
  let section: Section | undefined;
  for (const candidate of map.sections) {
    if (candidate.line < line0 || (candidate.line === line0 && candidate.column <= column0)) section = candidate;
    else break;
  }
  if (section === undefined) return undefined;
  const relativeLine = line0 - section.line;
  const relativeColumn = relativeLine === 0 ? column0 - section.column : column0;
  const segments = decodedLines(section.map)[relativeLine];
  if (segments === undefined) return undefined;
  let found: number[] | undefined;
  for (const segment of segments) {
    if (segment[0] > relativeColumn) break;
    found = segment;
  }
  if (found === undefined || found.length < 4) return undefined;
  const source = section.map.sources[found[1]];
  return typeof source === "string" && source !== "" ? { source, line: found[2] + 1, column: found[3] + 1 } : undefined;
}

// ------------------------------------------------------------------------------------ internals

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function plainMap(data: Record<string, unknown> | undefined): PlainMap | undefined {
  if (data === undefined || typeof data.mappings !== "string" || !Array.isArray(data.sources)) return undefined;
  const root = typeof data.sourceRoot === "string" ? data.sourceRoot : "";
  const sources = data.sources.map((source) => (typeof source === "string" ? joinSourceRoot(root, source) : ""));
  return { sources, mappings: data.mappings };
}

/** `sourceRoot` + source, as the spec says; an absolute or schemed source stays as it is. */
function joinSourceRoot(root: string, source: string): string {
  if (root === "" || /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith("/")) return source;
  return root.endsWith("/") ? `${root}${source}` : `${root}/${source}`;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((char, i) => [char, i]));

/**
 * The map's mappings, decoded once: per generated line, its segments with absolute values
 * [generatedColumn, sourceIndex, originalLine, originalColumn] (0-based; 1-field segments are
 * kept as [generatedColumn]). A malformed string ends the decoding where it breaks.
 */
function decodedLines(map: PlainMap): number[][][] {
  if (map.lines !== undefined) return map.lines;
  const lines: number[][][] = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (const line of map.mappings.split(";")) {
    const segments: number[][] = [];
    let generatedColumn = 0;
    for (const text of line.split(",")) {
      if (text === "") continue;
      const fields = decodeVlq(text);
      if (fields === undefined || fields.length === 0) {
        map.lines = [...lines, segments];
        return map.lines;
      }
      generatedColumn += fields[0];
      if (fields.length >= 4) {
        source += fields[1];
        originalLine += fields[2];
        originalColumn += fields[3];
        segments.push([generatedColumn, source, originalLine, originalColumn]);
      } else {
        segments.push([generatedColumn]);
      }
    }
    lines.push(segments);
  }
  map.lines = lines;
  return lines;
}

/** One segment's base64 VLQ fields; undefined for a character outside base64. */
function decodeVlq(text: string): number[] | undefined {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64_VALUE.get(char);
    if (digit === undefined) return undefined;
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      if (shift > 30) return undefined;
      continue;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return shift === 0 ? values : undefined;
}
