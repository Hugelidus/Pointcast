#!/usr/bin/env node
// Writes packages/cli/npm-shrinkwrap.json: the exact version of every package `npx pointcast`
// installs. npm honours a published package's shrinkwrap, so the MCP server the plugins start is
// the one that was reviewed and tested (the Claude plugin directory asks for this), not whatever
// the ranges in package.json resolve to on the day it is installed.
//
// It is generated from the published dependencies only: the devDependencies are workspace
// packages (bundled into dist/) and tools, and @huggingface/transformers is an optional peer
// that users add themselves. Run it after changing "dependencies":
//
//   pnpm --filter pointcast shrinkwrap
//
// packages/cli/src/shrinkwrap.test.ts fails when the file and package.json disagree.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(cliDir, "package.json"), "utf8"));
const work = mkdtempSync(path.join(tmpdir(), "pointcast-shrinkwrap-"));
try {
  const manifest = { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies };
  writeFileSync(path.join(work, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: work,
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  const lock = readFileSync(path.join(work, "package-lock.json"), "utf8");
  writeFileSync(path.join(cliDir, "npm-shrinkwrap.json"), lock);
  console.log(`wrote packages/cli/npm-shrinkwrap.json (${Object.keys(JSON.parse(lock).packages).length - 1} packages)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
