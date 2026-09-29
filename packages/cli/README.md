# pointcast

Turn a [pointcast](https://github.com/Hugelidus/pointcast) recording — a microphone transcript
plus the elements you pointed at while narrating — into a Markdown spec a coding agent can read,
or serve it straight to one over MCP. The recordings come from the pointcast Chrome extension
([install it from the releases](https://github.com/Hugelidus/pointcast/releases)).

Public beta (0.2): feedback and bug reports are welcome in the
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

The local model is `Xenova/whisper-base` (the extension's *Fast*). `--model Xenova/whisper-small` is
its *Accurate*: fewer misheard words, about twice as slow, a 512 MB download the first time.

## Commands

```
pointcast setup                    Set pointcast up in this project: your coding agents, your
                                   stack, the browser extension, then doctor. Asks first.
pointcast process [session-dir]   Transcribe (if needed), fuse and render session.md.
                                   Default session-dir: the latest session in
                                   --dir / POINTCAST_DIR / <Downloads>/pointcast.
pointcast transcribe <session-dir | file.wav>
                                   Write words.json from audio, on its own.
pointcast mcp                      Run a stdio MCP server exposing sessions read-only. While it
                                   runs, it also receives the extension's recordings on
                                   127.0.0.1, so they skip Chrome's downloads.
pointcast issue [session-dir] --repo owner/name
                                   Experimental: file the spec as a GitHub issue, linked to the code.
pointcast doctor                   Check this machine's setup, with a fix for each problem.
```

`process` writes `session.md` next to the recording and copies it to the clipboard, ready to
paste into a coding agent. Run `pointcast --help` for every flag (`--engine`, `--format`,
`--stdout`, …).

## Setting up

```sh
npx pointcast@latest setup
```

run in your project, looks for Claude Code, Codex, Gemini CLI (on PATH) and Cursor (a `.cursor`
folder, or on PATH) and, for each one that does not have pointcast yet, shows what it would do and
asks `y/N`: the plugin install commands for Claude Code and Codex, `gemini extensions install` for
Gemini CLI, and for Cursor the `pointcast` server (pinned to this exact version) merged into the
project's `.cursor/mcp.json`. It then says what your stack needs (the `pointcast-django` lines for
a Django project, nothing for React, Vue or Svelte dev builds), how to add the browser extension,
and runs `doctor`. It never edits your Python settings or an agent's config files itself.

`--dry-run` prints the plan and changes nothing (and skips `doctor`); `--yes` does every step
without asking; `--json` prints the plan and outcome for agents; `--repo <path>` sets it up for
another folder. Without a terminal and without `--yes` it is a dry run.

## Checking your setup

```sh
npx pointcast doctor
```

prints one line per check, with a fix under each problem: the Node.js version (22.12 or newer),
the sessions folder it reads (`--dir` / `POINTCAST_DIR` / `<Downloads>/pointcast`) with how many
recordings it holds and the newest one, whether a pointcast MCP server is receiving recordings
from the extension on 127.0.0.1:20547 (and which version), whether `@huggingface/transformers`
is installed for local transcription, and, on Linux, whether a clipboard tool (`wl-copy`, `xclip`
or `xsel`) is there. It only reads: it says hello to the MCP server but never sends it a
recording, and uses no network unless you add `--online`, which compares your version with the
latest on npm. `--json` prints the same report for scripts. It exits with 1 only when something
pointcast needs is broken (an old Node.js, a `--dir` or `POINTCAST_DIR` that does not exist);
optional parts that are not set up are warnings.

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

`pointcast mcp` runs a stdio [MCP](https://modelcontextprotocol.io) server, the main way an agent
gets your recordings: at Stop the extension hands the recording to it, and the agent fetches the
spec itself, with each element resolved to its line in your project. Pasting the spec from the
clipboard is the fallback for agents without MCP. Its 4 read-only tools:

- **list_sessions** — recent recordings, newest first, one per line in `{ "sessions": [...] }`:
  id, date, duration, the `pages` pointed at, how many `requests` and `elements`, a `preview` of
  the first request, `matchesProject` (whether its source files are in the project: `true`,
  `false`, or `"unknown"` when it names none) and `rendered` (its `session.md` is on disk).
- **get_session** — a recording's Markdown spec, by id, `"latest-here"` (the newest recording
  made on this project: newer ones whose files are all missing here are skipped, and it says
  which) or `"latest"` (the newest of all). Renders it from `session.json`/`words.json` if
  `session.md` isn't on disk yet; never transcribes. The spec starts with a line like
  `8 requests · 17 elements · ~3,100 tokens`.
- **get_element** — the full captured detail (selector, source location, styles, framework
  component, …) of one event, by session id and event id (e.g. `"e3"`).
- **wait_for_recording** — waits for your next recording and returns its spec, like
  `get_session`, as soon as you press Stop; after `timeoutSeconds` it answers "No new recording
  yet", and the agent calls it again. This is what `/pointcast watch` loops on.

An unknown session id gets the 3 newest ids with their preview in the error; an unknown event id
gets the valid range (`e1…e17`).

It looks for sessions the same way `pointcast process` does: `--dir` / `POINTCAST_DIR` /
`<Downloads>/pointcast`.

Pin the version in MCP configs (`pointcast@0.7`, as below): `npx` keeps using a cached copy for
an unversioned `pointcast`, which may be an older one. The plugins pin the exact version and
update it with each release.

`get_session`, `get_element` and `wait_for_recording` resolve [code locations](#code-locations)
in the project the server was started for: `--repo`, else `CLAUDE_PROJECT_DIR` (Claude Code sets
it), else the server's working directory. They and `list_sessions` also take an optional `repo`
argument. When none of the recording's files is in that project, the result starts with a
one-line warning that the recording is probably from another project.

### Listening: `wait_for_recording`

`wait_for_recording` returns as soon as a new recording arrives: one that was not in the sessions
folder when the agent first called it, and that no tool returned since. So a recording you make
while the agent is still applying the previous one is returned by the next call, and one it
already read with `get_session` is not returned twice. It works with several agent sessions open:
only one server receives from the extension, and the others see the recording appear in the
shared sessions folder.

A tool call cannot last forever, and each client cuts it off at a different time, so the default
wait follows the client:

| Client | Its limit for a tool call | Default wait |
|---|---|---|
| Claude Code | none for stdio servers (`MCP_TOOL_TIMEOUT` sets one); 30 min without a response or progress | 9 min |
| Gemini CLI | `timeout` in the server's settings, 10 min by default | 9 min |
| Codex | `tool_timeout_sec`, 60 s by default | 50 s |
| Cursor and others | not documented | 50 s |

The agent can pass `timeoutSeconds` (at most 1,500, 25 min). When the wait ends with no recording,
the answer is not an error, and the agent calls it again, so a short limit only means more calls.
While waiting, the server sends progress notifications when the client asks for them.

### Receiving recordings from the extension

While `pointcast mcp` runs, it also listens on `127.0.0.1:20547`, never on your network (a port
forward you set up is the exception, see *A remote dev server* below). At Stop
the extension (0.2+) hands it the recording, and the server stores it in its sessions folder, the
one its tools read. Chrome downloads nothing, so no Save dialog appears, even with Chrome's "Ask
where to save each file" on. When no server answers, the extension saves the recording with
Chrome's downloads as before. The popup says where each recording went.

- **Only from the pointcast extension.** The server takes a recording only from the official
  extension's id (its `chrome-extension://` origin), with pointcast's own header and content type,
  so web pages cannot send it one. For a fork, or an Edge Add-ons install until its id ships in a
  release, add ids with `POINTCAST_EXTENSION_IDS=<id>[,<id>…]`; the popup names the id when a
  server refuses it. An invalid id turns the receiver off (the server logs why); the tools keep
  working.
- **Never half-written, never overwritten.** Files are written to a hidden `.incoming-*` folder
  and then renamed to the session id. If that folder already exists, the extension falls back to
  Chrome's downloads.
- **Several servers** (several agents or projects): the first one to start receives. The others
  log that the port is in use and try again every 3 s, so one takes over within 3 s after it
  exits. A recording lands in the receiving server's folder when their `--dir` differ.
- **Turn it off** with `--no-handoff` or `POINTCAST_HANDOFF=off`, or in the extension's Settings
  (*Send to your agent's Pointcast MCP server*).
- **Shared multi-user computers:** `127.0.0.1` is shared by every user of the computer, so another
  user could send recordings to your server, or receive yours while it is down. Turn it off on
  both sides there.
- **A remote dev server** (your agent and `pointcast mcp` run on another machine over SSH):
  forward the port from your computer with `ssh -L 20547:127.0.0.1:20547 <host>`, with
  `pointcast mcp` running on the host. The extension's requests go through the tunnel, and the
  host's server stores the recordings where its tools read them. Mind that any forward of local
  port 20547 does this, including an editor's automatic port forwarding for a remote workspace
  (VS Code Remote-SSH, Codespaces): the recordings leave your computer for that host, and on a
  shared host the server on its port 20547 can be another user's. While the forward holds the
  port, a local `pointcast mcp` cannot receive. Never open the forward to your network
  (`ssh -g`, `GatewayPorts`): anyone who reaches it could send the host's server recordings.
- It logs to stderr only (stdout is the MCP channel): one line when it listens, one per stored
  recording.

`POINTCAST_HANDOFF_PORT` is a test hook: the extension's port is fixed when it is built.

### Claude Code channels (experimental)

Claude Code [channels](https://code.claude.com/docs/en/channels-reference) (a research preview)
let an MCP server push a message into a session, so Claude reacts without being asked. The server
declares a channel, and when it receives a recording from the extension, it tells the Claude Code
session it belongs to: `New pointcast recording 2026-09-29_10-00-00: 3 requests on
localhost:5173/orders. Apply it with the pointcast tools (get_session, id "…").` Claude then reads
the spec with the tools, like `/pointcast`.

- **Off unless you opt in.** Claude Code ignores it unless you start it with the channel enabled.
  During the preview only allowlisted plugins can register as a channel, and pointcast is not on
  the list, so it takes the development flag, which asks you to confirm at startup:
  `claude --dangerously-load-development-channels plugin:pointcast@pointcast`.
- **Only the id, counts and pages.** The message never carries the spec or anything you said or
  the page showed: text from a web page must not reach the agent as a message it acts on. Page
  paths are reduced to URL characters and cut short.
- **Only the receiving server announces.** With several Claude Code sessions open, the one whose
  server holds the handoff port gets the message. `/pointcast watch` works in any of them.
- Other agents get no message; `wait_for_recording` is their way to listen.

### Claude Code: plugin

The plugin adds the MCP server and a `/pointcast` command that fetches the latest recording made
on the project and applies it; `/pointcast watch` listens and applies each recording as you make
it. See [integrations/claude-code-plugin](https://github.com/Hugelidus/pointcast/blob/main/integrations/claude-code-plugin/README.md).

```sh
claude plugin marketplace add Hugelidus/pointcast
claude plugin install pointcast@pointcast
```

### Claude Code: MCP server only

```sh
claude mcp add pointcast -- npx -y pointcast@0.7 mcp
```

Or, pointed at a specific sessions folder:

```sh
claude mcp add pointcast -- npx -y pointcast@0.7 mcp --dir /path/to/pointcast-sessions
```

### Codex CLI

The same plugin works in Codex: the MCP server plus a `pointcast` skill. Start a new session after
installing it, then type `$pointcast:pointcast [session-id]` (or `$pointcast:pointcast watch`) or
ask to "apply my latest pointcast recording":

```sh
codex plugin marketplace add Hugelidus/pointcast
codex plugin add pointcast@pointcast
```

Codex starts the server in the session's folder, so code locations resolve there. It passes only a
fixed set of environment variables to MCP servers: to use `POINTCAST_DIR` (or another `POINTCAST_`
variable), list it in `env_vars = ["POINTCAST_DIR"]` under `[mcp_servers.pointcast]` in
`~/.codex/config.toml`. Codex does not wait for MCP servers before the first message, so a message
sent right at launch may not see the tools: send it again.

### Gemini CLI

The extension adds the MCP server (`npx -y pointcast@0.7 mcp --repo <the folder you run gemini
in>`) and a `/pointcast [session-id | watch]` command:

```sh
gemini extensions install https://github.com/Hugelidus/pointcast
```

Gemini starts extension commands and stdio MCP servers only in folders you trust (it asks the
first time). Update with `gemini extensions update pointcast`.

### Cursor

Add this to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global). `${workspaceFolder}`
tells the server which project to resolve code locations in:

```json
{
  "mcpServers": {
    "pointcast": {
      "command": "npx",
      "args": ["-y", "pointcast@0.7", "mcp", "--repo", "${workspaceFolder}"]
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
      "args": ["-y", "pointcast@0.7", "mcp"]
    }
  }
}
```

## Environment

`POINTCAST_DIR` (sessions folder), `POINTCAST_LANGUAGE`; for `--engine openai`:
`POINTCAST_API_BASE`, `POINTCAST_API_KEY` (`OPENAI_API_KEY` is used only for api.openai.com);
for `issue`: `GITHUB_TOKEN` (or `GH_TOKEN`); for `mcp`: `CLAUDE_PROJECT_DIR`,
`POINTCAST_HANDOFF` (`off` or `0`: do not receive recordings, like `--no-handoff`),
`POINTCAST_EXTENSION_IDS` (more extension ids to accept recordings from, comma-separated) and
`POINTCAST_HANDOFF_PORT` (tests only).

## License

MIT
