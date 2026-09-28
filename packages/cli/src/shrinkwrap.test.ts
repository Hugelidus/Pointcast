import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = join(__dirname, "..");
const readJson = (file: string) => JSON.parse(readFileSync(join(CLI, file), "utf8"));

describe("npm-shrinkwrap.json (scripts/shrinkwrap.mjs)", () => {
  const pkg = readJson("package.json");
  const lock = readJson("npm-shrinkwrap.json");

  it("locks exactly the published dependencies of this version", () => {
    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].dependencies).toEqual(pkg.dependencies);
  });

  it("pins every package to a registry tarball with an integrity hash", () => {
    for (const [where, entry] of Object.entries<{ resolved?: string; integrity?: string }>(lock.packages)) {
      if (where === "") continue;
      expect(entry.resolved, where).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity, where).toMatch(/^sha512-/);
    }
  });

  it("is published with the package", () => {
    expect(pkg.files).toContain("npm-shrinkwrap.json");
  });
});
