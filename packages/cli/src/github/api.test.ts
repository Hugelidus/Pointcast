import { describe, expect, it } from "vitest";
import { CliError } from "../errors";
import { createGitHubReader, githubToken, parseRepoSlug, permalink, resolveCommit } from "./api";
import { fakeGitHub, SHA } from "./fake-github";

const REPO = { owner: "octo", name: "web" };

describe("parseRepoSlug", () => {
  it.each(["octo/web", "https://github.com/octo/web", "https://github.com/octo/web.git", " octo/web/ "])("%j", (slug) => {
    expect(parseRepoSlug(slug)).toEqual(REPO);
  });
  it.each(["octo", "octo/web/extra", "../web", "octo/..", "-octo/web"])("rejects %j", (slug) => {
    expect(() => parseRepoSlug(slug)).toThrow(CliError);
  });
});

describe("permalink", () => {
  it("pins the file to the commit and encodes each path segment", () => {
    expect(permalink(REPO, SHA, "src/routes/(app)/+page.svelte", 12)).toBe(
      `https://github.com/octo/web/blob/${SHA}/src/routes/(app)/%2Bpage.svelte#L12`,
    );
  });
});

describe("resolveCommit", () => {
  it("resolves the default branch to its commit", async () => {
    const github = fakeGitHub({ files: {} });
    expect(await resolveCommit({ fetch: github.fetch }, REPO)).toBe(SHA);
    expect(github.requests.map((r) => r.url.pathname)).toEqual(["/repos/octo/web", "/repos/octo/web/commits/main"]);
  });

  it("takes a full sha as it is, without asking GitHub", async () => {
    const github = fakeGitHub({ files: {} });
    expect(await resolveCommit({ fetch: github.fetch }, REPO, SHA.toUpperCase())).toBe(SHA);
    expect(github.requests).toHaveLength(0);
  });

  it("explains a missing ref, and suggests a token when there is none", async () => {
    const github = fakeGitHub({ files: {} });
    await expect(resolveCommit({ fetch: github.fetch }, REPO, "nope")).rejects.toThrow(/Ref "nope" in octo\/web: not found.*GITHUB_TOKEN/);
  });

  it("sends the token when there is one", async () => {
    const github = fakeGitHub({ files: {} });
    await resolveCommit({ fetch: github.fetch, token: "t0k" }, REPO);
    expect(github.requests[0]!.headers.Authorization).toBe("Bearer t0k");
  });
});

describe("createGitHubReader", () => {
  it("reads a file at the commit, and finds a monorepo package's file by suffix in the tree", async () => {
    const github = fakeGitHub({ files: { "apps/web/src/App.tsx": "app", "README.md": "readme" } });
    const reader = createGitHubReader({ fetch: github.fetch }, REPO, SHA);
    expect(await reader.read("README.md")).toBe("readme");
    expect(await reader.read("src/App.tsx")).toBe("app");
    expect(await reader.locate("src/App.tsx")).toBe("apps/web/src/App.tsx");
    expect(await reader.read("src/Missing.tsx")).toBeUndefined();
    expect(reader.failure()).toBeUndefined();
    // The tree is listed once, and each file fetched once, however often it is asked for.
    await reader.read("src/App.tsx");
    const paths = github.requests.map((r) => r.url.pathname);
    expect(paths.filter((p) => p.includes("/git/trees/"))).toHaveLength(1);
    expect(paths.filter((p) => p.endsWith("/contents/apps/web/src/App.tsx"))).toHaveLength(1);
  });

  it("never asks GitHub for a path that leaves the repository", async () => {
    const github = fakeGitHub({ files: {} });
    const reader = createGitHubReader({ fetch: github.fetch }, REPO, SHA);
    expect(await reader.read("../../etc/passwd")).toBeUndefined();
    expect(github.requests).toHaveLength(0);
  });

  it("keeps a rate limit as a failure instead of passing it off as a missing file", async () => {
    const github = fakeGitHub({ files: {}, failWith: 403 });
    const reader = createGitHubReader({ fetch: github.fetch }, REPO, SHA);
    expect(await reader.read("src/App.tsx")).toBeUndefined();
    expect(reader.failure()?.message).toMatch(/rate limit.*GITHUB_TOKEN/);
  });
});

describe("githubToken", () => {
  it("prefers GITHUB_TOKEN, then GH_TOKEN, then gh's token", async () => {
    const fromGh = async () => "from-gh";
    expect(await githubToken({ GITHUB_TOKEN: "a", GH_TOKEN: "b" }, fromGh)).toBe("a");
    expect(await githubToken({ GH_TOKEN: "b" }, fromGh)).toBe("b");
    expect(await githubToken({}, fromGh)).toBe("from-gh");
    expect(await githubToken({}, async () => undefined)).toBeUndefined();
  });
});
