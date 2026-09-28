/** A Source Map v3 `mappings` encoder for tests: what a bundler writes, from readable segments. */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}

/** Per generated line, its segments as absolute 0-based [generatedColumn, source, line, column]. */
export function encodeMappings(lines: number[][][]): string {
  let source = 0;
  let line = 0;
  let column = 0;
  return lines
    .map((segments) => {
      let generated = 0;
      return segments
        .map(([g, s, l, c]) => {
          const text = vlq(g - generated) + vlq(s - source) + vlq(l - line) + vlq(c - column);
          generated = g;
          source = s;
          line = l;
          column = c;
          return text;
        })
        .join(",");
    })
    .join(";");
}

/**
 * One segment, as a stack trace would hit it: 1-based generated line and column mapped to a
 * 1-based original line and column of source `source` (an index into the map's sources).
 */
export function mapLines(points: { line: number; column: number; source: number; originalLine: number; originalColumn: number }[]): string {
  const byLine: number[][][] = [];
  for (const point of [...points].sort((a, b) => a.line - b.line || a.column - b.column)) {
    while (byLine.length < point.line) byLine.push([]);
    byLine[point.line - 1].push([point.column - 1, point.source, point.originalLine - 1, point.originalColumn - 1]);
  }
  return encodeMappings(byLine);
}
