import { execFile } from "node:child_process";
import { CliError } from "../errors";
import { normalizeProjectPath, SKIPPED_DIRS, uniqueSuffixMatch, type LocatingReader } from "../resolve/repo-reader";

/**
 * Route 4, CLI side: just enough of GitHub's REST API for `pointcast issue`, over the global
 * fetch (no SDK dependency). Everything takes a `GitHubClient`, so tests hand in a mocked fetch
 * and never reach the network.
 */

export interface GitHubRepo {
  owner: string;
  name: string;
}

export interface GitHubClient {
  fetch: typeof fetch;
  /** Needed to create an issue and to read a private repository; public reads work without one. */
  token?: string;
}

const API = "https://api.github.com";

/** "owner/name", also written as a github.com URL (with or without ".git"). */
export function parseRepoSlug(value: string): GitHubRepo {
  const slug = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/.exec(slug);
  if (match === null || match[2] === "." || match[2] === "..") {
    throw new CliError(`--repo must be a GitHub repository as owner/name, e.g. octo-org/web-app (got "${value}").`);
  }
  return { owner: match[1]!, name: match[2]! };
}

export function repoLabel(repo: GitHubRepo): string {
  return `${repo.owner}/${repo.name}`;
}

/** Path segments encoded one by one, so "/" stays a separator and nothing else is special. */
function encodePath(file: string): string {
  return file.split("/").map(encodeURIComponent).join("/");
}

/** https://github.com/<o>/<r>/blob/<sha>/<file>#L<line>: pinned to a commit, so it never drifts. */
export function permalink(repo: GitHubRepo, sha: string, file: string, line?: number): string {
  return `https://github.com/${repo.owner}/${repo.name}/blob/${sha}/${encodePath(file)}${line === undefined ? "" : `#L${line}`}`;
}

async function request(
  client: GitHubClient,
  path: string,
  init: { method?: string; accept?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: init.accept ?? "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pointcast",
  };
  if (client.token) headers.Authorization = `Bearer ${client.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await client.fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    throw new CliError(`Could not reach GitHub: ${(error as Error).message}`);
  }
}

/** A one-line, actionable error for a non-2xx answer. */
async function failure(response: Response, what: string, client: GitHubClient): Promise<CliError> {
  const detail = await response
    .json()
    .then((body: unknown) => {
      const message = (body as { message?: unknown } | null)?.message;
      return typeof message === "string" ? message : undefined;
    })
    .catch(() => undefined);
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    return new CliError(
      client.token
        ? "GitHub's API rate limit is used up; try again in a while."
        : "GitHub's API rate limit for requests without a token is used up: set GITHUB_TOKEN or log in with `gh auth login`.",
    );
  }
  if (response.status === 401) return new CliError("GitHub rejected the token (401): check GITHUB_TOKEN or run `gh auth login` again.");
  if (response.status === 404 && !client.token) {
    return new CliError(`${what}: not found. If the repository is private, set GITHUB_TOKEN or log in with \`gh auth login\`.`);
  }
  return new CliError(`${what}: GitHub answered ${response.status}${detail ? ` (${detail})` : ""}.`);
}

/**
 * The commit to read and link: `ref` (a branch, tag or sha) or the default branch. Resolving it
 * once pins every read and every permalink to the same version, even if the branch moves.
 */
export async function resolveCommit(client: GitHubClient, repo: GitHubRepo, ref?: string): Promise<string> {
  if (ref !== undefined && /^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
  const base = `/repos/${repo.owner}/${repo.name}`;
  let branch = ref;
  if (branch === undefined) {
    const response = await request(client, base);
    if (!response.ok) throw await failure(response, `Repository ${repoLabel(repo)}`, client);
    branch = ((await response.json()) as { default_branch?: string }).default_branch;
    if (!branch) throw new CliError(`Repository ${repoLabel(repo)} has no default branch (is it empty?).`);
  }
  const response = await request(client, `${base}/commits/${encodeURIComponent(branch)}`, {
    accept: "application/vnd.github.sha",
  });
  if (!response.ok) throw await failure(response, `Ref "${branch}" in ${repoLabel(repo)}`, client);
  const sha = (await response.text()).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new CliError(`GitHub did not return a commit for "${branch}" in ${repoLabel(repo)}.`);
  return sha.toLowerCase();
}

export interface GitHubReader extends LocatingReader {
  /**
   * The first error that was not "file not found" (rate limit, bad token, network). Core's
   * resolver counts a throwing read as "unreadable", which would pass a rate limit off as "wrong
   * repository"; the caller checks this after resolving and reports the real cause.
   */
  failure(): CliError | undefined;
}

/**
 * A SourceReader over GitHub's contents API at one commit. Like the local reader, a path missing
 * at the root is found by unique path suffix (monorepos), here in the commit's file tree, which is
 * fetched once and only when needed. Every file is fetched at most once.
 */
export function createGitHubReader(client: GitHubClient, repo: GitHubRepo, sha: string): GitHubReader {
  const base = `/repos/${repo.owner}/${repo.name}`;
  const contents = new Map<string, Promise<string | undefined>>();
  const located = new Map<string, Promise<string | undefined>>();
  let tree: Promise<string[]> | undefined;
  let firstFailure: CliError | undefined;

  const guarded = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      firstFailure ??= error;
      return fallback;
    }
  };

  const fetchFile = (file: string): Promise<string | undefined> => {
    let result = contents.get(file);
    if (result === undefined) {
      result = guarded(async () => {
        const response = await request(client, `${base}/contents/${encodePath(file)}?ref=${sha}`, {
          accept: "application/vnd.github.raw+json",
        });
        if (response.status === 404) return undefined;
        if (!response.ok) throw await failure(response, `Reading ${file} from ${repoLabel(repo)}`, client);
        return response.text();
      }, undefined);
      contents.set(file, result);
    }
    return result;
  };

  const fetchTree = (): Promise<string[]> =>
    guarded(async () => {
      const response = await request(client, `${base}/git/trees/${sha}?recursive=1`);
      if (!response.ok) throw await failure(response, `Listing the files of ${repoLabel(repo)}`, client);
      const body = (await response.json()) as { tree?: { path?: unknown; type?: unknown }[] };
      return (body.tree ?? [])
        .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
        .map((entry) => entry.path as string)
        .filter((file) => !file.split("/").some((segment) => SKIPPED_DIRS.has(segment)));
    }, []);

  const find = async (file: string): Promise<string | undefined> => {
    const wanted = normalizeProjectPath(file);
    if (wanted === undefined) return undefined;
    if ((await fetchFile(wanted)) !== undefined) return wanted;
    tree ??= fetchTree();
    const match = uniqueSuffixMatch(await tree, wanted);
    return match !== undefined && (await fetchFile(match)) !== undefined ? match : undefined;
  };

  const locate = (file: string): Promise<string | undefined> => {
    let result = located.get(file);
    if (result === undefined) {
      result = find(file);
      located.set(file, result);
    }
    return result;
  };

  return {
    locate,
    async read(file) {
      const found = await locate(file);
      return found === undefined ? undefined : fetchFile(found);
    },
    failure: () => firstFailure,
  };
}

export async function createIssue(
  client: GitHubClient,
  repo: GitHubRepo,
  issue: { title: string; body: string },
): Promise<{ number: number; url: string }> {
  const response = await request(client, `/repos/${repo.owner}/${repo.name}/issues`, { method: "POST", body: issue });
  if (!response.ok) throw await failure(response, `Creating an issue in ${repoLabel(repo)}`, client);
  const created = (await response.json()) as { number: number; html_url: string };
  return { number: created.number, url: created.html_url };
}

/**
 * GITHUB_TOKEN (or GH_TOKEN), else the token the gh CLI is logged in with, else none. `gh` is
 * asked quietly (no window, short timeout); not having it installed is not an error.
 */
export async function githubToken(
  env: Record<string, string | undefined>,
  fromGh: () => Promise<string | undefined> = ghAuthToken,
): Promise<string | undefined> {
  return env.GITHUB_TOKEN || env.GH_TOKEN || (await fromGh());
}

function ghAuthToken(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("gh", ["auth", "token"], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim() || undefined);
    });
  });
}
