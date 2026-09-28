# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately through GitHub: [Report a vulnerability](https://github.com/Hugelidus/pointcast/security/advisories/new) (the repository's *Security* tab). You will get an answer within a few days, and credit in the release notes if you want it.

Useful to include: the version (extension, CLI), your browser and OS, the steps to reproduce, and what an attacker gains.

## What matters most

pointcast handles your voice, your app's pages and your source code, and hands recordings to a coding agent that can edit files and run commands. The parts most worth attacking, and reporting:

- **The MCP server's receiver** (`pointcast mcp`, `127.0.0.1:20547`): anything that lets a web page, another extension or another program deliver a recording to it, write outside its sessions folder, or read from it. Its design and threat model: [docs/decisions.md, D11](../docs/decisions.md#d11-handoff-to-a-running-mcp-server).
- **Capture privacy**: anything sensitive (password fields, `data-sensitive`, personal data on enabled sites) that reaches a session file or the spec ([D8](../docs/decisions.md#d8-privacy)).
- **Prompt injection through a recording**: text in a recorded page that makes the agent do something the user did not ask for, beyond what a page's own text can already do.

## Supported versions

Only the latest release receives fixes. The extension updates itself from the Chrome Web Store; the plugins pin the CLI's exact version, which each release bumps.
