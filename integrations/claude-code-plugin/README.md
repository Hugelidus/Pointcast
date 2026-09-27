# pointcast plugin for Claude Code

Record yourself talking through changes while you point at your web app, then type `/pointcast`
in Claude Code: it fetches the latest recording and applies it.

The plugin contains:

- **The pointcast MCP server** (`npx -y pointcast mcp`), with read-only tools: `list_sessions`,
  `get_session` and `get_element`. They find the recordings the pointcast extension saved
  (`<Downloads>/pointcast`, or `POINTCAST_DIR`) and resolve each pointed element to its line in
  this project's source.
- **`/pointcast [session-id]`**: fetches the latest recording (or the one you name) with
  `get_session` and applies it, following the spec's rules: change only what was pointed at, ask
  when something is ambiguous. The spec's code pointers (`text at:`, `code:`) take the agent
  straight to the right lines instead of searching the codebase. Plain `/pointcast` works unless
  another command already uses the name; `/pointcast:pointcast` always works.

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

## Other clients

The MCP server works in any MCP client; only `/pointcast` is Claude Code specific. Without the
plugin:

- Claude Code: `claude mcp add pointcast -- npx -y pointcast mcp`
- Cursor, `.cursor/mcp.json`:
  `{ "mcpServers": { "pointcast": { "command": "npx", "args": ["-y", "pointcast", "mcp", "--repo", "${workspaceFolder}"] } } }`
- Windsurf, `~/.codeium/windsurf/mcp_config.json`:
  `{ "mcpServers": { "pointcast": { "command": "npx", "args": ["-y", "pointcast", "mcp"] } } }`

More in the [CLI's README](../../packages/cli/README.md#mcp-server).

## Which project it reads

Claude Code starts plugin MCP servers outside the project (in `~/.claude`), but tells them the
project in `CLAUDE_PROJECT_DIR`; pointcast resolves code locations there. If none of a
recording's files is in the project, `get_session` starts with a warning that the recording is
probably from another project, and `/pointcast` stops to ask you before editing.

## Development

`claude plugin validate ./integrations/claude-code-plugin` and `claude plugin validate .` (the
marketplace, from the repository root) check the manifests.
`packages/cli/src/plugin.test.ts` checks that the files agree with each other and with the MCP
server's tool names.
