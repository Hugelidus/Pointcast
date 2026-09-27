import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP, sessionWithChain, SOURCES, TOOLBAR } from "../resolve/test-support";
import { fakeGitHub, SHA } from "./fake-github";
import { linkCodeLocations, MAX_URL_CHARS, prefilledIssueUrl, runIssue } from "./issue";

/** The project lives in a monorepo package, so links must use the path in the repository. */
const REPO_FILES = Object.fromEntries(Object.entries(SOURCES).map(([file, source]) => [`apps/web/${file}`, source]));
const blob = (file: string, line: number) => `https://github.com/octo/web/blob/${SHA}/apps/web/${file}#L${line}`;

describe("pointcast issue (route 4)", () => {
  let sessionDir: string;
  beforeEach(() => {
    sessionDir = sessionWithChain();
  });
  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it("--dry-run: resolves in the repository and links every code location at the commit", async () => {
    const github = fakeGitHub({ files: REPO_FILES });
    const result = await runIssue({ sessionDir, repo: "octo/web", mode: "dry-run", client: { fetch: github.fetch } });

    expect(result.sha).toBe(SHA);
    expect(result.matches).toBe(true);
    expect(result.found).toBe(1);
    expect(result.body).toContain(`text at: [\`${TOOLBAR}:4\`](${blob(TOOLBAR, 4)})`);
    expect(result.body).toContain(`[\`${TOOLBAR}:3\`](${blob(TOOLBAR, 3)})`);
    expect(result.body).toContain(`[\`${APP}:3\`](${blob(APP, 3)})`);
    expect(result.body).toContain(`octo/web@${SHA.slice(0, 7)}`);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.title.length).toBeLessThanOrEqual(80);
    expect(result.url).toBeUndefined();
    expect(github.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("creates the issue with a token, and only then", async () => {
    const github = fakeGitHub({ files: REPO_FILES });
    await expect(runIssue({ sessionDir, repo: "octo/web", mode: "create", client: { fetch: github.fetch } })).rejects.toThrow(
      /needs a GitHub token/,
    );
    expect(github.requests).toHaveLength(0);

    const result = await runIssue({ sessionDir, repo: "octo/web", mode: "create", client: { fetch: github.fetch, token: "t0k" } });
    expect(result.url).toBe("https://github.com/octo/web/issues/42");
    const post = github.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ title: result.title, body: result.body });
  });

  it("refuses to create the issue in a repository that has none of the recording's files", async () => {
    const github = fakeGitHub({ files: { "README.md": "another app" } });
    await expect(
      runIssue({ sessionDir, repo: "octo/web", mode: "create", client: { fetch: github.fetch, token: "t0k" } }),
    ).rejects.toThrow(/wrong repository/);
    expect(github.requests.some((r) => r.method === "POST")).toBe(false);

    const dry = await runIssue({ sessionDir, repo: "octo/web", mode: "dry-run", client: { fetch: github.fetch } });
    expect(dry.matches).toBe(false);
    expect(dry.body).not.toContain("https://github.com/octo/web/blob/");
  });

  it("reports a rate limit as such, not as a wrong repository", async () => {
    const github = fakeGitHub({ files: REPO_FILES, failWith: 403 });
    await expect(runIssue({ sessionDir, repo: "octo/web", ref: SHA, mode: "dry-run", client: { fetch: github.fetch } })).rejects.toThrow(
      /rate limit/,
    );
  });

  it("--open: a prefilled issues/new link, without a token and without creating anything", async () => {
    const github = fakeGitHub({ files: REPO_FILES });
    const result = await runIssue({ sessionDir, repo: "octo/web", mode: "open", client: { fetch: github.fetch } });
    const url = new URL(result.url!);
    expect(url.origin + url.pathname).toBe("https://github.com/octo/web/issues/new");
    expect(url.searchParams.get("title")).toBe(result.title);
    expect(url.searchParams.get("body")).toBe(result.body);
    expect(github.requests.some((r) => r.method === "POST")).toBe(false);
  });
});

describe("prefilledIssueUrl", () => {
  it("gives up past the URL limit, so the caller prints the body instead", () => {
    const repo = { owner: "octo", name: "web" };
    expect(prefilledIssueUrl(repo, "t", "short")).toBeDefined();
    expect(prefilledIssueUrl(repo, "t", "x".repeat(MAX_URL_CHARS))).toBeUndefined();
  });
});

describe("linkCodeLocations", () => {
  const linkFor = (file: string, line?: number) => (file === "src/a.ts" ? `https://x/${file}${line ? `#L${line}` : ""}` : undefined);

  it("links known files with or without a line, and leaves the rest alone", () => {
    const markdown = "code: `<a>` at `src/a.ts:3:7` ← `<B>` in `src/a.ts` ← `<C>` at `src/other.ts:9`";
    expect(linkCodeLocations(markdown, linkFor)).toBe(
      "code: `<a>` at [`src/a.ts:3:7`](https://x/src/a.ts#L3) ← `<B>` in [`src/a.ts`](https://x/src/a.ts) ← `<C>` at `src/other.ts:9`",
    );
  });

  it("does not touch fenced code blocks", () => {
    const markdown = ["```", "`src/a.ts:1`", "```", "`src/a.ts:2`"].join("\n");
    expect(linkCodeLocations(markdown, linkFor)).toBe(["```", "`src/a.ts:1`", "```", "[`src/a.ts:2`](https://x/src/a.ts#L2)"].join("\n"));
  });
});
