/**
 * A stand-in for api.github.com, served through a mocked fetch: the tests never reach the
 * network, never create a real issue and never open a browser. It serves one repository
 * ("octo/web") at one commit, and records every request.
 */

export const SHA = "0123456789abcdef0123456789abcdef01234567";

export interface FakeRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
}

export interface FakeGitHubOptions {
  /** Files of the commit, by path in the repository. */
  files: Record<string, string>;
  /** Answer every request with this status instead (403 = rate limit). */
  failWith?: number;
}

export function fakeGitHub(options: FakeGitHubOptions) {
  const requests: FakeRequest[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    requests.push({ method, url, headers, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });

    if (url.origin !== "https://api.github.com") throw new Error(`unexpected host ${url.origin}`);
    if (options.failWith !== undefined) {
      return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: options.failWith,
        headers: { "x-ratelimit-remaining": "0" },
      });
    }
    const path = url.pathname;
    if (method === "GET" && path === "/repos/octo/web") return json({ default_branch: "main" });
    if (method === "GET" && path === "/repos/octo/web/commits/main") return new Response(SHA);
    if (method === "GET" && path.startsWith("/repos/octo/web/contents/") && url.searchParams.get("ref") === SHA) {
      const file = path.slice("/repos/octo/web/contents/".length).split("/").map(decodeURIComponent).join("/");
      return file in options.files ? new Response(options.files[file]) : json({ message: "Not Found" }, 404);
    }
    if (method === "GET" && path === `/repos/octo/web/git/trees/${SHA}`) {
      return json({ sha: SHA, truncated: false, tree: Object.keys(options.files).map((file) => ({ path: file, type: "blob" })) });
    }
    if (method === "POST" && path === "/repos/octo/web/issues") {
      return json({ number: 42, html_url: "https://github.com/octo/web/issues/42" }, 201);
    }
    return json({ message: "Not Found" }, 404);
  }) as typeof globalThis.fetch;

  return { fetch, requests };
}
