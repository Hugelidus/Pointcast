import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createRepoReader, normalizeProjectPath, uniqueSuffixMatch } from "./repo-reader";
import { projectWith } from "./test-support";

describe("createRepoReader", () => {
  const roots: string[] = [];
  const project = (files: Record<string, string>, prefix?: string) => {
    const root = projectWith(files, prefix);
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("reads a project-relative path at the root", async () => {
    const reader = createRepoReader(project({ "src/App.tsx": "app" }));
    expect(await reader.read("src/App.tsx")).toBe("app");
    expect(await reader.locate("./src/App.tsx")).toBe("src/App.tsx");
    expect(await reader.read("src/Missing.tsx")).toBeUndefined();
  });

  it("finds a monorepo package's file by its unique path suffix", async () => {
    const reader = createRepoReader(project({ "src/lib/More.svelte": "more", "package.json": "{}" }, "apps/web/"));
    expect(await reader.read("src/lib/More.svelte")).toBe("more");
    expect(await reader.locate("src/lib/More.svelte")).toBe("apps/web/src/lib/More.svelte");
  });

  it("finds nothing when two packages end with the same path", async () => {
    const root = project({ "apps/web/src/App.tsx": "web", "apps/admin/src/App.tsx": "admin" });
    expect(await createRepoReader(root).read("src/App.tsx")).toBeUndefined();
  });

  it("does not count copies in node_modules, dist or build as matches", async () => {
    const root = project({
      "apps/web/src/App.tsx": "web",
      "node_modules/pkg/src/App.tsx": "dep",
      "apps/web/dist/src/App.tsx": "built",
      "build/src/App.tsx": "built",
    });
    expect(await createRepoReader(root).read("src/App.tsx")).toBe("web");
  });

  it("stops scanning after maxFiles", async () => {
    const root = project({ "a.txt": "", "b.txt": "", "deep/src/App.tsx": "app" });
    expect(await createRepoReader(root, { maxFiles: 2 }).read("src/App.tsx")).toBeUndefined();
  });

  it("never reads outside the root", async () => {
    const root = project({ "inner/src/App.tsx": "app" }, "project/");
    const reader = createRepoReader(`${root}/project/inner`);
    for (const escape of ["../../project/inner/src/App.tsx", "src/../../inner/src/App.tsx", "C:/Windows/win.ini", "file:///etc/hosts"]) {
      expect(await reader.read(escape)).toBeUndefined();
    }
  });
});

describe("normalizeProjectPath", () => {
  it.each([
    ["src/App.tsx", "src/App.tsx"],
    ["./src/App.tsx", "src/App.tsx"],
    ["/src/App.tsx", "src/App.tsx"],
    ["src\\lib\\More.svelte", "src/lib/More.svelte"],
    ["../src/App.tsx", undefined],
    ["src//App.tsx", undefined],
    ["C:/Users/x/App.tsx", undefined],
    ["", undefined],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeProjectPath(input)).toBe(expected);
  });
});

describe("uniqueSuffixMatch", () => {
  it("matches whole path segments only", () => {
    expect(uniqueSuffixMatch(["apps/web/src/App.tsx"], "src/App.tsx")).toBe("apps/web/src/App.tsx");
    expect(uniqueSuffixMatch(["apps/web/mysrc/App.tsx"], "src/App.tsx")).toBeUndefined();
  });
});
