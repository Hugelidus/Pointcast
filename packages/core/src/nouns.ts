import { normalizeWord } from "./deictics";
import { codeSpan } from "./markdown";
import type { Word } from "./schema";

/**
 * "Esta tabla" while pointing at a header cell means the table, not the cell. The noun the
 * user said near the gesture tells which ancestor they meant; the element's readable path
 * (D3) already names every ancestor, so we look it up there.
 */

type Kind =
  | "table"
  | "row"
  | "column"
  | "button"
  | "bar"
  | "text"
  | "field"
  | "link"
  | "menu"
  | "title";

/** Spanish and English nouns, normalized (no accents), singular and plural. */
const NOUNS: Readonly<Record<string, Kind>> = Object.fromEntries(
  (
    [
      ["table", ["tabla", "tablas", "table", "tables"]],
      ["row", ["fila", "filas", "row", "rows"]],
      ["column", ["columna", "columnas", "column", "columns"]],
      ["button", ["boton", "botones", "button", "buttons"]],
      ["bar", ["barra", "barras", "cabecera", "bar", "bars", "toolbar", "navbar", "header"]],
      ["text", ["texto", "textos", "parrafo", "parrafos", "text", "paragraph", "paragraphs"]],
      ["field", ["campo", "campos", "field", "fields", "input", "inputs"]],
      ["link", ["enlace", "enlaces", "vinculo", "link", "links"]],
      ["menu", ["menu", "menus"]],
      ["title", ["titulo", "titulos", "title", "titles", "heading", "headings"]],
    ] as const
  ).flatMap(([kind, nouns]) => nouns.map((noun) => [noun, kind])),
);

/** Does a path segment such as "nav«Main»" or "div.toolbar" match the kind? */
function segmentMatches(kind: Exclude<Kind, "column">, segment: string): boolean {
  const tag = /^[a-z][a-z\d-]*/i.exec(segment)?.[0].toLowerCase() ?? "";
  switch (kind) {
    case "table":
      return tag === "table";
    case "row":
      return tag === "tr";
    case "button":
      return tag === "button";
    case "bar":
      return tag === "header" || tag === "nav" || /toolbar/i.test(segment);
    case "text":
      return tag === "p";
    case "field":
      return tag === "input" || tag === "textarea" || tag === "select";
    case "link":
      return tag === "a";
    case "menu":
      return tag === "nav" || tag === "menu" || /menu/i.test(segment);
    case "title":
      return /^h[1-6]$/.test(tag);
  }
}

/** How far from the gesture's word a noun still counts: "esta tabla", "la tabla esta". */
const AFTER = 3;
const BEFORE = 2;

/**
 * The noun said next to the anchor word, within the sentence [from, to): the closest word
 * after the anchor first ("este botón"), then the anchor itself, then before it.
 */
export function spokenNoun(
  words: readonly Word[],
  anchor: number,
  from: number,
  to: number,
): { word: string; kind: Kind } | undefined {
  const order = [
    ...Array.from({ length: AFTER }, (_, i) => anchor + 1 + i),
    anchor,
    ...Array.from({ length: BEFORE }, (_, i) => anchor - 1 - i),
  ];
  for (const k of order) {
    if (k < from || k >= to) continue;
    const kind = NOUNS[normalizeWord(words[k].text)];
    if (kind) return { word: words[k].text.trim().replace(/[\p{P}]+$/u, ""), kind };
  }
  return undefined;
}

/**
 * What the noun points to, as Markdown, or undefined when the element itself already is that
 * thing (or nothing in the path matches). `path` is ElementInfo.path.
 */
export function nounTarget(kind: Kind, path: string): string | undefined {
  const segments = path.split(" › ");
  if (kind === "column") return columnTarget(segments);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!segmentMatches(kind, segments[i])) continue;
    if (i === segments.length - 1) return undefined;
    return codeSpan(segments.slice(0, i + 1).join(" › "));
  }
  return undefined;
}

/** "column 3 of `… › table#orders`" from the nearest th[n]/td[n] in the path. */
function columnTarget(segments: readonly string[]): string | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    const cell = /^t[hd]\b.*\[(\d+)\]$/.exec(segments[i]);
    if (!cell) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (/^table\b/.test(segments[j])) {
        return `column ${cell[1]} of ${codeSpan(segments.slice(0, j + 1).join(" › "))} (its header and the cell at that position in every row)`;
      }
    }
    return undefined;
  }
  return undefined;
}
