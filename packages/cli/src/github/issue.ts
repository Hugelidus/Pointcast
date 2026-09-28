import {
  cleanNote,
  isTypedSession,
  projectMatch,
  renderMarkdown,
  resolveSession,
  TYPED_SESSION_WORDS,
  type RenderFormat,
  type SessionFile,
  type WordsFile,
} from "@pointcast/core";
import { CliError } from "../errors";
import { readSessionFile } from "../process/session-file";
import { readWordsFileIfPresent } from "../process/words-file";
import { normalizeProjectPath } from "../resolve/repo-reader";
import {
  createGitHubReader,
  createIssue,
  parseRepoSlug,
  permalink,
  repoLabel,
  resolveCommit,
  type GitHubClient,
  type GitHubReader,
  type GitHubRepo,
} from "./api";

/**
 * `pointcast issue`: the spec as a GitHub issue, its code locations resolved in the repository
 * the issue is filed in, and every `file:line` of the chain and of the resolved locations linked
 * to that file at the commit it was read at. Someone picking the issue up (a person or an agent
 * with no local checkout) lands on the right line with one click.
 */

export type IssueMode = "create" | "dry-run" | "open";

export interface IssueOptions {
  sessionDir: string;
  /** "owner/name". */
  repo: string;
  /** Branch, tag or sha; default branch when omitted. */
  ref?: string;
  mode: IssueMode;
  format?: RenderFormat;
  client: GitHubClient;
}

export interface IssueResult {
  repo: GitHubRepo;
  sha: string;
  title: string;
  body: string;
  /** From core's projectMatch: false when none of the recording's source files is in the repo. */
  matches: boolean | undefined;
  /** Chain files the recording names (for the mismatch message). */
  files: string[];
  /** Resolved code locations added to the spec. */
  found: number;
  /** create: the new issue; open: the prefilled issues/new link, unless the body is too long for one. */
  url?: string;
}

/** GitHub's limit on an issue body. */
export const MAX_BODY_CHARS = 65_536;
/** Longer links are refused by browsers or GitHub (414); past this, --open prints the body instead. */
export const MAX_URL_CHARS = 8_000;

export async function runIssue(options: IssueOptions): Promise<IssueResult> {
  if (options.mode === "create" && !options.client.token) {
    throw new CliError(
      "Creating an issue needs a GitHub token: set GITHUB_TOKEN or log in with `gh auth login`. " +
        "Or use --open to file it from a prefilled link, or --dry-run to print it.",
    );
  }
  const session = await readSessionFile(options.sessionDir);
  // A typed session (D12) renders from its notes and has no words.json.
  const words = isTypedSession(session) ? TYPED_SESSION_WORDS : await readWordsFileIfPresent(options.sessionDir);
  if (words === undefined) {
    throw new CliError(`${options.sessionDir} has no words.json yet. Run "pointcast process ${options.sessionDir}" first.`);
  }

  const repo = parseRepoSlug(options.repo);
  const sha = await resolveCommit(options.client, repo, options.ref);
  const reader = createGitHubReader(options.client, repo, sha);
  const match = await projectMatch(session, reader);
  throwIfFailed(reader);
  if (match.matches === false && options.mode === "create") {
    throw new CliError(
      `None of the source files this recording points at (${match.files.slice(0, 2).join(", ")}) is in ${repoLabel(repo)} ` +
        `at ${sha.slice(0, 7)}, so it looks like the wrong repository: not filing the issue. ` +
        "Check --repo and --ref, or look at it first with --dry-run.",
    );
  }
  const resolved = match.matches ? await resolveSession(session, reader, "github") : session;
  throwIfFailed(reader);

  const markdown = renderMarkdown(resolved, words, options.format ? { format: options.format } : {});
  const targets = await linkTargets(resolved, match.files, reader);
  const linked = linkCodeLocations(markdown, (file, line) => {
    const target = targets.get(file);
    return target === undefined ? undefined : permalink(repo, sha, target, line);
  });
  const body =
    linked.trimEnd() +
    (targets.size > 0 ? `\n\n---\n\n<sub>Recorded with pointcast. Code links point at ${repoLabel(repo)}@${sha.slice(0, 7)}.</sub>\n` : "\n");
  const title = issueTitle(session, words);
  const found = resolved.events.reduce((sum, event) => sum + (event.element.resolved?.length ?? 0), 0);
  const result: IssueResult = { repo, sha, title, body, matches: match.matches, files: match.files, found };

  if (options.mode === "dry-run") return result;
  if (options.mode === "open") {
    const url = prefilledIssueUrl(repo, title, body);
    return url === undefined ? result : { ...result, url };
  }
  if (body.length > MAX_BODY_CHARS) {
    throw new CliError(`The issue body is ${body.length} characters, over GitHub's ${MAX_BODY_CHARS}. Use --dry-run and shorten it.`);
  }
  const created = await createIssue(options.client, repo, { title, body });
  return { ...result, url: created.url };
}

function throwIfFailed(reader: GitHubReader): void {
  const failure = reader.failure();
  if (failure) throw failure;
}

/** Project-relative path as the spec prints it -> path in the repository, for every file found. */
async function linkTargets(session: SessionFile, chainFiles: readonly string[], reader: GitHubReader): Promise<Map<string, string>> {
  const files = new Set(chainFiles);
  for (const event of session.events) {
    for (const location of event.element.resolved ?? []) {
      const file = normalizeProjectPath(location.file);
      if (file !== undefined) files.add(file);
    }
  }
  const targets = new Map<string, string>();
  for (const file of files) {
    const found = await reader.locate(file);
    if (found !== undefined) targets.set(file, found);
  }
  return targets;
}

/**
 * Turns every code span holding `file` or `file:line` (`file:line:column`) into a link, when
 * `linkFor` knows the file. Fenced code blocks are left alone. The span keeps the path the spec
 * printed; only the link target uses the path in the repository.
 */
export function linkCodeLocations(markdown: string, linkFor: (file: string, line?: number) => string | undefined): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/(`+)(.+?)\1(?!`)/g, (span, _ticks: string, inner: string) => {
        const location = /^(.+?)(?::(\d+)(?::\d+)?)?$/.exec(inner.trim());
        if (location === null) return span;
        const url = linkFor(location[1]!, location[2] === undefined ? undefined : Number(location[2]));
        return url === undefined ? span : `[${span}](${url})`;
      });
    })
    .join("\n");
}

/**
 * The first spoken sentence (the first typed note, in a typed session), at most ~80 characters;
 * the session id when nothing was said or noted.
 */
export function issueTitle(session: SessionFile, words: WordsFile): string {
  const spaced = words.words.some((word) => /^\s/.test(word.text));
  const firstNote = session.events.map((event) => cleanNote(event.note)).find((note) => note !== undefined);
  const spoken = (isTypedSession(session) ? (firstNote ?? "") : words.words.map((word) => word.text).join(spaced ? "" : " "))
    .replace(/\s+/g, " ")
    .trim();
  const sentence = spoken.split(/(?<=[.!?])\s/)[0] ?? "";
  if (sentence === "") return `UI changes (pointcast recording ${session.id})`;
  if (sentence.length <= 80) return sentence;
  const cut = sentence.slice(0, 79);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

/** github.com/<o>/<r>/issues/new with title and body filled in; undefined when it would be too long. */
export function prefilledIssueUrl(repo: GitHubRepo, title: string, body: string): string | undefined {
  const url =
    `https://github.com/${repo.owner}/${repo.name}/issues/new` +
    `?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return url.length <= MAX_URL_CHARS ? url : undefined;
}
