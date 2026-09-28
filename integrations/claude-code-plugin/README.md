# pointcast plugin for Claude Code and Codex

Record yourself talking through changes while you point at your web app, then type `/pointcast`
in Claude Code (or `$pointcast:pointcast` in Codex): it fetches the latest recording and applies
it.

The plugin contains:

- **The pointcast MCP server** (`npx -y pointcast@0.3.0 mcp`), with read-only tools:
  `list_sessions`, `get_session` and `get_element`. They find the recordings the pointcast
  extension saved (`<Downloads>/pointcast`, or `POINTCAST_DIR`) and resolve each pointed element
  to its line in this project's source.
- **The `pointcast` skill**, `/pointcast [session-id]` in Claude Code: fetches the latest
  recording (or the one you name) with `get_session` and applies it, following the spec's rules:
  change only what was pointed at, ask when something is ambiguous. The spec's code pointers
  (`text at:`, `code:`) take the agent straight to the right lines instead of searching the
  codebase. Plain `/pointcast` works unless another command already uses the name;
  `/pointcast:pointcast` always works.

While your agent is open, recordings go straight to the plugin's MCP server: no downloads and no
Save dialogs. The server receives them on `127.0.0.1` from the pointcast extension only, and
stores them in its sessions folder (see the
[CLI's README](../../packages/cli/README.md#receiving-recordings-from-the-extension)).

It needs Node.js 22 or later on your PATH, for `npx`.

## Install

This repository is also a plugin marketplace. In a shell:

```sh
claude plugin marketplace add Hugelidus/pointcast
claude plugin install pointcast@pointcast
```

Or inside Claude Code: `/plugin marketplace add Hugelidus/pointcast`, then
`/plugin install pointcast@pointcast`.

To try a local checkout without installing it, start Claude Code with
`claude --plugin-dir ./integrations/claude-code-plugin`.

### Codex

Codex reads the same marketplace and plugin:

```sh
codex plugin marketplace add Hugelidus/pointcast
codex plugin add pointcast@pointcast
```

Start a new Codex session afterwards, then type `$pointcast:pointcast [session-id]`, or ask to
"apply my latest pointcast recording". Codex starts the server in the session's folder and
resolves code locations there. Two differences from Claude Code:

- Codex passes only a fixed set of environment variables to MCP servers. To use `POINTCAST_DIR`,
  list it in `env_vars = ["POINTCAST_DIR"]` under `[mcp_servers.pointcast]` in
  `~/.codex/config.toml`.
- Codex does not wait for MCP servers before the first message: if a message sent right at launch
  does not see the tools, send it again.

## Other clients

The MCP server works in any MCP client. Without the plugin:

- Gemini CLI: the repository is also a Gemini CLI extension, with the MCP server and the same
  skill as `/pointcast`: `gemini extensions install https://github.com/Hugelidus/pointcast`
- Claude Code: `claude mcp add pointcast -- npx -y pointcast@0.2 mcp`
- Cursor, `.cursor/mcp.json`:
  `{ "mcpServers": { "pointcast": { "command": "npx", "args": ["-y", "pointcast@0.2", "mcp", "--repo", "${workspaceFolder}"] } } }`
- Windsurf, `~/.codeium/windsurf/mcp_config.json`:
  `{ "mcpServers": { "pointcast": { "command": "npx", "args": ["-y", "pointcast@0.2", "mcp"] } } }`

More in the [CLI's README](../../packages/cli/README.md#mcp-server).

## Which project it reads

Claude Code starts plugin MCP servers outside the project (in `~/.claude`), but tells them the
project in `CLAUDE_PROJECT_DIR`; pointcast resolves code locations there. If none of a
recording's files is in the project, `get_session` starts with a warning that the recording is
probably from another project, and `/pointcast` stops to ask you before editing.

## Development

The manifests are checked by each agent's validator:

- Claude Code: `claude plugin validate --strict ./integrations/claude-code-plugin`, and
  `claude plugin validate --strict .` for the marketplace, from the repository root;
- Codex: `$CODEX_HOME/skills/.system/plugin-creator/scripts/validate_plugin.py integrations/claude-code-plugin`;
- Gemini CLI: `gemini extensions validate .` (the root `gemini-extension.json` and
  `commands/pointcast.toml`).

`packages/cli/src/plugin.test.ts` checks that the files agree with each other and with the MCP
server's tool names, and that the `pointcast@<version>` pin is the CLI's exact version.
`packages/cli/src/gemini-extension.test.ts` keeps the Gemini manifest and its `/pointcast` prompt
equal to the plugin's.
