# pointcast privacy policy

Effective 28 September 2026. It covers the pointcast Chrome extension, the `pointcast` CLI and its MCP server.

**In short: pointcast does not collect, sell or share your data.** There is no account, no analytics, no telemetry and no pointcast server on the internet. What you record is processed on your computer and saved on your computer.

## What the extension handles, and where it stays

- **Your voice.** The microphone is recorded only between Record and Stop. The recording is transcribed on your device, inside the extension (Whisper runs in the browser). The audio is then discarded, unless you turn on *Keep audio* in the settings, or pointcast needs it to redo the transcription (the spoken language was uncertain, or transcription failed). In those cases it is saved as `audio.wav` in the recording's folder on your computer.
- **The elements you point at.** Only when you Alt+click or select text on a page where pointcast is active: local development hosts (`localhost`, `127.0.0.1`, `*.localhost`, `*.test`), or a site you enabled yourself, one at a time. For each element pointcast keeps:
  - its visible text;
  - a CSS selector and its position in the page;
  - its HTML, reduced to a fixed list of allowed attributes;
  - a few computed styles;
  - the page's URL;
  - the names and file paths of the components that rendered it, when the page is a development build that exposes them.

  Password fields and other sensitive inputs are never captured. On sites that are not local development hosts, text that looks like personal data (email addresses, phone numbers, card and bank account numbers, tokens) is redacted, and secrets in URLs are removed.
- **Your app's source code (development builds only).** When you press Stop, the extension may read the source files of the components you pointed at from the page's own development server (the same origin as the page) to find the exact lines. They are read into memory only. The spec keeps file paths, line numbers and the one source line of each location it found.
- **The result.** The spec is copied to your clipboard, and the recording is saved as files on your computer: by Chrome's downloads in `Downloads/pointcast/<recording>/`, or, when a pointcast MCP server runs on your computer, by that server in its sessions folder (request 3 below). Nothing is uploaded.
- **Settings and state** are kept in the browser's extension storage on your device.

## Network requests

The extension makes only these requests:

1. **Once, to download the speech model** (`Xenova/whisper-base`, about 291 MB) from Hugging Face, which is then kept in the browser's cache. No data of yours is sent with it. As with any download, Hugging Face sees ordinary request information such as your IP address.
2. **To the page's own development server**, to read source files as described above.
3. **To a pointcast MCP server on your own computer** (`http://127.0.0.1:20547`), only while *Send to a running pointcast MCP server* is on in the settings (the default). After Stop it sends a short, empty hello; when a pointcast MCP server answers, it sends it the recording's files. This request never leaves your computer, unless you forward that port to another machine yourself (for example `ssh -L 20547:127.0.0.1:20547`, or an editor's automatic port forwarding for a remote workspace): the recording then goes through the forward to the pointcast MCP server on that machine. A program on that port that is not pointcast only ever receives the empty hello.

There are no other requests: no analytics, telemetry, crash reports or advertising.

## The CLI and MCP server

They run on your computer. They read the recordings in your Downloads folder (or the folder you give them) and your project's source code there, and send nothing anywhere, with two exceptions that only happen when you ask for them:

- `--engine openai` sends a recording's audio to the OpenAI-compatible endpoint you configure, with your API key.
- `pointcast issue` (experimental) sends a recording's spec to GitHub to create an issue in a repository you name.

While it runs, the MCP server also listens on `127.0.0.1` (never on your network, unless you forward the port there yourself) to receive recordings from the extension. It accepts them from the pointcast extension only, and stores them in its sessions folder. `--no-handoff` turns this off.

The MCP server gives your coding agent (for example Claude Code) the recordings you ask it to read. What that agent does with them is covered by its own provider's policy.

## Keeping and deleting your data

Everything stays on your computer. Delete a recording by deleting its folder in `Downloads/pointcast/`, or in your MCP server's sessions folder if you gave it another one. Uninstalling the extension removes its settings and the cached speech model.

## Children

pointcast is a developer tool and is not directed at children.

## Changes

Changes to this policy are published in this file, with a new effective date. Its history is public in the [repository](https://github.com/Hugelidus/pointcast/commits/main/PRIVACY.md).

## Contact

Questions or concerns: open an issue at https://github.com/Hugelidus/pointcast/issues.
