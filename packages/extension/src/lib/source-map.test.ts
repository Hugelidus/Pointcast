import { describe, expect, it } from "vitest";
import { originalPosition, parseSourceMap } from "./source-map";
import { encodeMappings } from "./test-utils/source-map-encode";

describe("source maps (Next.js chunks, D9 note 2026-09-28)", () => {
  it("maps a stack position through a plain map: the segment at or before the column", () => {
    const map = parseSourceMap(
      JSON.stringify({
        version: 3,
        sources: ["file:///C:/app/components/nav-link.tsx", "file:///C:/app/lib/nav.ts"],
        mappings: encodeMappings([[], [[0, 0, 4, 2], [10, 1, 7, 0]], [[3, 0, 12, 15]]]),
      }),
    );
    if (map === undefined) throw new Error("not parsed");
    expect(originalPosition(map, 2, 1)).toEqual({ source: "file:///C:/app/components/nav-link.tsx", line: 5, column: 3 });
    expect(originalPosition(map, 2, 9)).toEqual({ source: "file:///C:/app/components/nav-link.tsx", line: 5, column: 3 });
    expect(originalPosition(map, 2, 11)).toEqual({ source: "file:///C:/app/lib/nav.ts", line: 8, column: 1 });
    expect(originalPosition(map, 3, 40)).toEqual({ source: "file:///C:/app/components/nav-link.tsx", line: 13, column: 16 });
    // Before the first segment of a line, a line with none, past the end: no position.
    expect(originalPosition(map, 3, 2)).toBeUndefined();
    expect(originalPosition(map, 1, 1)).toBeUndefined();
    expect(originalPosition(map, 9, 1)).toBeUndefined();
  });

  it("maps through an index map's sections, as Turbopack writes them", () => {
    const section = (sourceFile: string, line: number) => ({
      version: 3,
      sources: [sourceFile],
      mappings: encodeMappings([[[0, 0, line, 0]], [[4, 0, line + 1, 6]]]),
    });
    const map = parseSourceMap(
      JSON.stringify({
        version: 3,
        sources: [],
        sections: [
          { offset: { line: 4, column: 0 }, map: section("file:///C:/app/app/layout.tsx", 14) },
          { offset: { line: 20, column: 0 }, map: section("file:///C:/app/components/sidebar.tsx", 12) },
        ],
      }),
    );
    if (map === undefined) throw new Error("not parsed");
    expect(originalPosition(map, 6, 10)).toEqual({ source: "file:///C:/app/app/layout.tsx", line: 16, column: 7 });
    expect(originalPosition(map, 21, 1)).toEqual({ source: "file:///C:/app/components/sidebar.tsx", line: 13, column: 1 });
    expect(originalPosition(map, 2, 1)).toBeUndefined();
  });

  it("applies sourceRoot to relative sources only", () => {
    const map = parseSourceMap(
      JSON.stringify({ version: 3, sourceRoot: "webpack://app/", sources: ["./a.tsx"], mappings: encodeMappings([[[0, 0, 0, 0]]]) }),
    );
    expect(map && originalPosition(map, 1, 1)?.source).toBe("webpack://app/./a.tsx");
  });

  it("gives no map for what is not a v3 map, and no position for broken mappings", () => {
    expect(parseSourceMap("<!doctype html>")).toBeUndefined();
    expect(parseSourceMap(JSON.stringify({ version: 2, sources: [], mappings: "" }))).toBeUndefined();
    expect(parseSourceMap(JSON.stringify({ version: 3, sections: [{ offset: { line: -1, column: 0 }, map: {} }] }))).toBeUndefined();
    const broken = parseSourceMap(JSON.stringify({ version: 3, sources: ["a"], mappings: "AAAA;!!!!" }));
    if (broken === undefined) throw new Error("not parsed");
    expect(originalPosition(broken, 1, 1)).toEqual({ source: "a", line: 1, column: 1 });
    expect(originalPosition(broken, 2, 1)).toBeUndefined();
  });
});
