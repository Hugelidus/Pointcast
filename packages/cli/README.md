# pointcast

Turn a [pointcast](https://github.com/Hugelidus/pointcast) recording — a microphone transcript
plus the elements you pointed at while narrating — into a Markdown spec a coding agent can read,
or serve it straight to one over MCP. The recordings come from the pointcast Chrome extension
([install it from the releases](https://github.com/Hugelidus/pointcast/releases)).

Public beta (0.1): feedback and bug reports are welcome in the
[issues](https://github.com/Hugelidus/pointcast/issues).

## Install

No install needed — run it with `npx`:

```sh
npx pointcast --help
```

The extension already transcribes in the browser, so the CLI does not install a speech model by
default. To transcribe on this machine (`pointcast transcribe`, `process --force`, or a recording
the extension could not transcribe), add `@huggingface/transformers` (about 450 MB with ONNX
Runtime):

```sh
npm install -g pointcast @huggingface/transformers
# or, without installing:
npx -p pointcast -p @huggingface/transformers pointcast process --force
```

`--engine openai` needs neither.

## Commands

```
pointcast process [session-dir]   Transcribe (if needed), fuse and render session.md.
                                   Default session-dir: the latest session in
                                   --dir / POINTCAST_DIR / <Downloads>/pointcast.
pointcast transcribe <session-dir | file.wav>
                                   Write words.json from audio, on its own.
pointcast mcp                      Run a stdio MCP server exposing sessions read-only.
pointcast issue [session-dir] --repo owner/name
                                   Experimental: file the spec as a GitHub issue, linked to the code.
```

`process` writes `session.md` next to the recording and copies it to the clipboard, ready to
paste into a coding agent. Run `pointcast --help` for every flag (`--engine`, `--format`,
`--stdout`, …).

## Code locations

When the recording was made on a dev build (React, Vue, Svelte), each pointed element carries the
chain of components that rendered it. pointcast then looks the element's text up in those files
and adds the line that holds it to the spec:

```
- [a] «Export» → code:
  - used at: `src/pages/Dashboard.tsx` — `<OrdersTable>`
  - text at: `src/components/OrdersTable.tsx:22` — `<button type="button" id="orders-export" className="btn btn-export"> Export </button>`
  - within: `<Dashboard>` in `src/App.tsx` ← `<App>` in `src/main.tsx`
```

In a small evaluation this more than halved the tokens a coding agent spent finding the elements
([docs/eval](https://github.com/Hugelidus/pointcast/blob/main/docs/eval/stage0-code-pointer-2026-09-27.md)). The lookup needs your source, so
it runs where the source is:

- **`pointcast process`** uses the current directory, when the recording's files are in it, or
  `--repo <project folder>`. Otherwise it renders the spec without the lines and says why in one
  line. In a monorepo, run it from the repository root: a file the recording calls
  `src/App.tsx` is also found at `apps/web/src/App.tsx`, when only one file matches.
- **The MCP server** (below) uses the project it was started for.
- **`pointcast issue`** reads the GitHub repository (below).

Only lines that match exactly once are added; nothing is added when a match is ambiguous.
`session.json` is never changed.

## GitHub issues (experimental)

The issue body is the raw spec for now; it will be rewritten into a readable issue before this
leaves the experimental stage.

```sh
pointcast issue --repo owner/name --dry-run   # print the title and body
pointcast issue --repo owner/name             # create the issue
pointcast issue --repo owner/name --open      # print and open a prefilled issues/new link
```

`issue` takes the latest session (or the one you name), reads the repository at its default
branch or `--ref <branch|tag|sha>`, resolves the code locations there, and links every
`file:line` to that file at that commit, so the links never drift. Creating the issue needs a
token: `GITHUB_TOKEN`, else the one `gh auth login` stored. Reading a public repository works
without one, within GitHub's rate limit. `--open` needs no token; when the body is too long for a
link, it prints the body for you to paste. If none of the recording's files is in the
repository, `issue` refuses to create the issue, since it looks like the wrong repository.

## MCP server

`pointcast mcp` runs a stdio [MCP](https://modelcontextprotocol.io) server with 3 read-only tools,
so an agent can look up a recording itself instead of you pasting `session.md` in:

- **list_sessions** — recent sessions (id, date, duration, event count), newest first.
- **get_session** — a session's Markdown spec, by id or `"latest"`. Renders it from
  `session.json`/`words.json` if `session.md` isn't on disk yet; never transcribes.
- **get_element** — the full captured detail (selector, source location, styles, framework
  component, …) of one event, by session id and event id (e.g. `"e3"`).

It looks for sessions the same way `pointcast process` does: `--dir` / `POINTCAST_DIR` /
`<Downloads>/pointcast`.

`get_session` and `get_element` resolve [code locations](#code-locations) in the project the
server was started for: `--repo`, else `CLAUDE_PROJECT_DIR` (Claude Code sets it), else the
server's working directory. Both tools also take an optional `repo` argument. When none of the
recording's files is in that project, the result starts with a one-line warning that the
recording is probably from another project.

### Claude Code: plugin

The plugin adds the MCP server and a `/pointcast` command that fetches the latest recording and
applies it. See [integrations/claude-code-plugin](https://github.com/Hugelidus/pointcast/blob/main/integrations/claude-code-plugin/README.md).

```sh
claude plugin marketplace add Hugelidus/pointcast
claude plugin install pointcast@pointcast
```

### Claude Code: MCP server only

```sh
claude mcp add pointcast -- npx -y pointcast mcp
```

Or, pointed at a specific sessions folder:

```sh
claude mcp add pointcast -- npx -y pointcast mcp --dir /path/to/pointcast-sessions
```

### Cursor

Add this to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global). `${workspaceFolder}`
tells the server which project to resolve code locations in:

```json
{
  "mcpServers": {
    "pointcast": {
      "command": "npx",
      "args": ["-y", "pointcast", "mcp", "--repo", "${workspaceFolder}"]
    }
  }
}
```

### Windsurf

Add this to `~/.codeium/windsurf/mcp_config.json`. The config is global, so the agent passes the
project folder as the tools' `repo` argument when the server's working directory is not the
project:

```json
{
  "mcpServers": {
    "pointcast": {
      "command": "npx",
      "args": ["-y", "pointcast", "mcp"]
    }
  }
}
```

## Environment

`POINTCAST_DIR` (sessions folder), `POINTCAST_LANGUAGE`; for `--engine openai`:
`POINTCAST_API_BASE`, `POINTCAST_API_KEY` (`OPENAI_API_KEY` is used only for api.openai.com);
for `issue`: `GITHUB_TOKEN` (or `GH_TOKEN`); for `mcp`: `CLAUDE_PROJECT_DIR`.

## License

MIT
