# Listings: where Pointcast is listed, and what to paste

One section per place: its status, the exact text, and the steps. Everything here is done by the owner by hand; nothing has been submitted from this file. Marked **Not verified** where a form or page could not be read from here (only GitHub content was read, through `gh api`, on 2026-09-28).

| Place | Status | When |
|---|---|---|
| [Claude plugin directory](#claude-plugin-directory) | submitted, in review | check status |
| [Claude community marketplace](#claude-community-marketplace) | probably the same review as above | only if it turns out to be separate |
| [Chrome Web Store](#chrome-web-store) | 0.1.2 in review | upload 0.7.0 when approved |
| [Microsoft Edge Add-ons](#microsoft-edge-add-ons) | not submitted | before launch |
| [Gemini CLI extensions gallery](#gemini-cli-extensions-gallery) | automatic | verify before launch |
| [MCP Registry](#mcp-registry) | needs a CLI release with `mcpName` | with CLI 0.6.0 |
| [awesome-mcp-servers](#awesome-mcp-servers) | not submitted | week before launch |
| [awesome-claude-code](#awesome-claude-code) | not eligible yet | after launch, from 2026-10-11, once it has users |
| [PyPI: pointcast-django](#pypi-pointcast-django) | not published | before launch |

---

## Claude plugin directory

**Where:** claude.ai/directory/manage. **Status:** submitted, in manual review. The plugin pins the CLI's exact version, which the directory requires (D11, *Pinned plugin versions*).

**Steps now:** check the submission's status there. When 0.6.0 is the version under review, nothing to change: the plugin (`integrations/claude-code-plugin`) starts `pointcast@0.6.0`, and the marketplace entry is `.claude-plugin/marketplace.json`. If the reviewers ask for changes, answer in the same submission rather than submitting again.

**Reviewer note.** Keep the note you sent with the submission; its text is not in the repository, so it could not be copied here. If the form asks for one again (a resubmission, or the community form below), this is a draft to adapt, not the original:

```
Pointcast turns a recording made with its browser extension (the user's voice plus the web-page elements they Alt+clicked) into a Markdown spec, and resolves each element to its line in the user's repository.

The plugin adds one MCP server and one skill:
- MCP server: `npx -y pointcast@0.6.0 mcp` (exact version, npm package "pointcast", MIT, source in packages/cli; dependencies locked by npm-shrinkwrap.json). Three read-only tools: list_sessions, get_session, get_element. They read recordings from a local folder (<Downloads>/pointcast by default) and the user's project files; nothing is sent over the network.
- Skill /pointcast: fetches the latest recording through those tools and applies the requested changes in the project.

The server also listens on 127.0.0.1:20547 (never on the network) to receive recordings from the Pointcast extension: it checks Host, the extension's Origin, a custom header and the content type before reading a byte, and only writes new session folders. It can be turned off with --no-handoff or POINTCAST_HANDOFF=off. Design and threat model: docs/decisions.md#d11-handoff-to-a-running-mcp-server.

To test without the extension: copy the recorded sample session in dev/fixtures/sessions/e2e-es-v2 (session.json, words.json) into a folder, start Claude Code with POINTCAST_DIR set to that folder, and run /pointcast (or ask for the latest pointcast recording).
```

(Try the test paragraph yourself once before pasting it: the sample is an e2e fixture on a test page, so its elements have no code lines.)

## Claude community marketplace

**Where:** the form at `clau.de/plugin-directory-submission`. Its public result is [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community), a read-only mirror "synced nightly from Anthropic's internal review pipeline"; its README says every plugin there "has been submitted via claude.ai" through that same link, and that pull requests to the repository are closed automatically. Once listed, users install with `claude plugin marketplace add anthropics/claude-plugins-community` and `claude plugin install pointcast@claude-community`.

**Before submitting:** open the link and see where it lands. **Not verified** (the form could not be opened from here): whether it is the same submission flow as claude.ai/directory/manage. If it lands on the directory submission you already made, do **not** submit a second time; Pointcast is not in the community marketplace yet (checked: not among its 2,282 plugins on 2026-09-28), which fits a submission still in review.

**If it is a separate form**, the texts to paste (field names guessed; match them to the form):

- **Name:** `pointcast` (the immutable slug; the display name is Pointcast)
- **Repository:** `https://github.com/Hugelidus/pointcast` (marketplace file `.claude-plugin/marketplace.json`, plugin in `integrations/claude-code-plugin`)
- **Category:** development
- **Short description:**

  ```
  Apply what you said while pointing at your web app: the Pointcast MCP server plus a /pointcast skill that fetches your latest recording and goes straight to the lines of code behind each element.
  ```

- **Long description:**

  ```
  Record yourself talking (or typing a note) through UI changes while you Alt+click the elements you mean, with the Pointcast browser extension (Chrome and Edge). Your voice is transcribed locally, in the browser, and the recording goes straight to this plugin's MCP server on 127.0.0.1. Then /pointcast fetches it: one request per sentence, each element with its location in your source (React 19, Vue 3 and Svelte 5 dev builds, Django templates with pointcast-django). In an evaluation on three open-source dashboards, pointing raised the agent's element accuracy from 78% to 89%; with a recording of several changes read through this MCP server, the agent found the right code 96% of the time against 85% for the same changes typed by hand, at 24% fewer tokens and 75% fewer searches. MIT, no account, no cloud.
  ```

- **Reviewer note:** the draft in the previous section.
- **Privacy policy:** `https://github.com/Hugelidus/pointcast/blob/main/PRIVACY.md`

## Chrome Web Store

Everything, tab by tab: [chrome-web-store.md](chrome-web-store.md). Status: 0.1.2 submitted as *Unlisted*, in review.

**When approved:** upload the latest release's store zip (the `pointcast-0.7.0-chrome-store` artifact of the v0.7.0 release workflow run, or `pnpm --filter @pointcast/extension zip:store`; never the GitHub release zip), and put the listing's link in the README's Quick start.

**Optional description update for 0.5** (the text under "IT POINTS AT THE CODE" names React, Vue 3 and Svelte 5 only). Replacement for its first sentence, if you want to mention Django:

```
On development builds of React, Vue 3 and Svelte 5, and on Django templates with the pointcast-django package, each element leads with its code: where that instance is used, and the line of its text or data in your source, quoted.
```

Change it in a separate listing update after approval, not while the item is in review, so the review isn't restarted for a text change.

## Microsoft Edge Add-ons

Everything, step by step: [edge-addons.md](edge-addons.md). Same store zip as Chrome. Two things to add for 0.5:

- **YouTube video URL:** the form has a field for it. Upload `docs/launch/video/out/pointcast-demo.mp4` (~27.5 s) to YouTube (unlisted is enough) and paste the link, if you want the video on the listing.
- **After publishing:** append Edge's item id to `OFFICIAL_EXTENSION_IDS` (`packages/core/src/handoff.ts`) in the next CLI release, as edge-addons.md explains.

## Gemini CLI extensions gallery

**Automatic:** the gallery picks up public repositories with the `gemini-cli-extension` topic (CONTRIBUTING, Releasing step 7) and a `gemini-extension.json` at the root. Nothing to submit.

Checked on 2026-09-28 with `gh api`:

- the topic `gemini-cli-extension` is set on Hugelidus/pointcast;
- `gemini-extension.json` is at the root, version 0.6.0, starting `pointcast@0.6.0`;
- the latest release, v0.6.0, is published (not a draft) with 3 assets (release zip, CLI tarball, `SHA256SUMS.txt`), none named `win32.*`/`darwin.*`/`linux.*`, so `gemini extensions install` installs the source (CONTRIBUTING, Releasing step 6).

**To verify by hand:** search for "pointcast" in the gallery (**Not verified** from here: the gallery page could not be opened, and its crawl may take a few days). Then, in a clean folder: `gemini extensions install https://github.com/Hugelidus/pointcast`, `gemini extensions list`, and `/pointcast` in a trusted folder.

## MCP Registry

The official registry ([modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry), in preview) hosts metadata only; clients and other directories read it. Draft: [mcp-registry/server.json](mcp-registry/server.json), valid against the registry's draft `server.schema.json` (checked locally with `jsonschema`).

**Name: `io.github.Hugelidus/pointcast`, with a capital H.** The brief asked for `io.github.hugelidus/pointcast`, but GitHub login grants the namespace `io.github.<login>/*` with the login's exact casing, and the check is case-sensitive: the registry builds `io.github.%s/*` from the GitHub login (`internal/api/handlers/v0/auth/github_at.go`) and compares with `strings.HasPrefix` (`internal/auth/jwt.go`). Open issue [#689](https://github.com/modelcontextprotocol/registry/issues/689) reports exactly this: a lowercase name for a capitalized owner fails with 403. So `mcpName` and `server.json` must both say `io.github.Hugelidus/pointcast`, unless #689 is fixed by then.

**What the draft says:**

- npm package `pointcast`, started as `npx pointcast@<version> mcp` (`runtimeHint: npx`, positional argument `mcp`), stdio;
- `repository.subfolder: packages/cli` and the repository's GitHub id (1391168726);
- two optional environment variables (`POINTCAST_DIR`, `POINTCAST_HANDOFF`);
- the 128 px icon from `docs/launch/store/icon-128.png` (served from `raw.githubusercontent.com`, main branch);
- `description` is 96 characters (the schema's maximum is 100).

**Version:** `0.6.0`, the first CLI release that carries `mcpName` (`io.github.Hugelidus/pointcast`). The registry checks that the npm package at that version has `mcpName` equal to the server name; later releases: set `version` and `packages[0].version` to the release.

**Steps:**

1. **CLI with `mcpName`:** done in 0.6.0. Check it arrived: `npm view pointcast@0.6.0 mcpName`.
2. **Install `mcp-publisher`** (Windows, from the registry's quickstart; it downloads the latest release binary):

   ```powershell
   $arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }; Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile "mcp-publisher.tar.gz"; tar xf mcp-publisher.tar.gz mcp-publisher.exe; rm mcp-publisher.tar.gz
   ```

   Then `mcp-publisher --help`.
3. **Copy and update the draft:** copy `docs/launch/mcp-registry/server.json` to a working folder (or to `packages/cli/server.json`, if you want to keep it next to the package), set both versions, and run `mcp-publisher validate`. If the validator rejects a field (`icons`, `environmentVariables`), drop that field rather than fight it: only `name`, `description`, `version` and the package are needed.
4. **Log in:** `mcp-publisher login github` (device flow: open github.com/login/device, enter the code, authorize).
5. **Publish:** `mcp-publisher publish` in the folder with `server.json`.
6. **Check:** `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Hugelidus/pointcast"`.
7. **Each later CLI release:** bump both versions in `server.json` and publish again (the registry keeps one entry per version). The registry can also be updated from GitHub Actions (its `github-actions` guide); not set up.

**Not verified:** `mcp-publisher validate` and `publish` were not run (no publisher binary here, and publishing is the owner's). The `$schema` URL (`2025-12-11`) is the one the registry's current docs and `mcp-publisher init` template use.

## awesome-mcp-servers

**Where:** [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers), by pull request editing `README.md` (fork, branch, one line, PR). Its CONTRIBUTING asks for: the name linked to the repository, a short description, the right category, alphabetical order within it, one server per line.

**Category: 💻 Developer Tools** (`#developer-tools`). MCP Pointer, the closest tool, is listed there too.

**The line:**

```markdown
- [Hugelidus/pointcast](https://github.com/Hugelidus/pointcast) 📇 🏠 🪟 🐧 - Voice and Alt+click recordings of your web app from a browser extension, served to coding agents as a spec that locates each element in your source (React, Vue and Svelte dev builds, Django templates).
```

- Legend: 📇 TypeScript, 🏠 local service, 🪟 Windows, 🐧 Linux (CI runs the tests on Windows and Ubuntu). No 🍎: macOS is untested; add it when someone confirms it works.
- **Place:** alphabetical by owner, between the `homespunapps/homespun` and `hungthai1401/bruno-mcp` lines of the Developer Tools section (checked in the README on 2026-09-28; re-check, the list moves daily).
- Many entries also carry a Glama score badge (`https://glama.ai/mcp/servers/<owner>/<repo>/badges/score.svg`). It isn't required, and it only works once glama.ai has indexed the server (the list says its web directory is synced with the repository); leave it out unless Glama lists Pointcast by then.
- **PR title:** `Add Hugelidus/pointcast`. **PR body:**

  ```
  Adds Pointcast to Developer Tools: a local MCP server (npm "pointcast", `npx -y pointcast@0.5 mcp`) with 3 read-only tools (list_sessions, get_session, get_element) that serve recordings from the Pointcast browser extension, the user's voice plus the elements they Alt+clicked, and resolve each element to its file and line in the local repository. MIT.
  ```

## awesome-claude-code

**Where:** [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code), **only through the web issue form** ("Recommend a Resource"): its CONTRIBUTING says recommendations made any other way (a PR, or `gh`) risk a temporary restriction, and that they must be made by a human.

**When: after launch, once Pointcast has some users.** Eligibility is at least 14 days of active development since the first commit on the default branch, or 100 stars. `main`'s first commit is 2026-09-27, so the earliest date is **2026-10-11**, with commits after that first day (there are). The maintainer also says plainly that projects should get users first and submit afterwards, and that the list is selective. One resource at a time.

**The form's fields** (from `.github/ISSUE_TEMPLATE/recommend-resource.yml`, read on 2026-09-28):

- **Title:** `[Resource]: Pointcast`
- **Display Name:** `Pointcast`
- **Category:** `Design & UI/UX` (next to Dev Browser and Snip; the alternative is `Remote Control, Notifications & Voice I/O`)
- **Link:** `https://github.com/Hugelidus/pointcast`
- **Author Name:** `Hugelidus`
- **Author Link:** `https://github.com/Hugelidus`
- **Description** (10–500 characters, descriptive, no addressing the reader, one line, no emojis):

  ```
  A browser extension and Claude Code plugin that records the user's voice while they Alt+click elements of their web app, transcribes it locally with Whisper, and gives Claude one request per sentence with each element's source location (React, Vue and Svelte dev builds, Django templates). /pointcast fetches the latest recording through a local MCP server. Includes a published evaluation of element accuracy and token use.
  ```

- **Checklist:** tick the five required boxes only after actually doing what they say (visiting the list, checking the links, reading CONTRIBUTING). Leave the last box unchecked: the form says so.

## PyPI: pointcast-django

The package builds as it is: `python -m build` in a copy of `integrations/django` gave `pointcast_django-0.1.0.tar.gz` and `pointcast_django-0.1.0-py3-none-any.whl`, and `twine check` passed on both (2026-09-28). The name `pointcast-django` has no release on PyPI (`pip index versions pointcast-django` finds nothing). Upload is the owner's (his account and 2FA).

**Once: the account.**

1. Create an account on https://pypi.org (and one on https://test.pypi.org: they are separate). PyPI requires two-factor authentication: set up an authenticator app or a security key, and save the recovery codes.
2. Create an **API token** in *Account settings → API tokens*. The first upload needs an account-wide token (the project doesn't exist yet); after the first upload, replace it with a token scoped to `pointcast-django`.

**Recommended before the first upload:** add a `LICENSE` file to `integrations/django` (a copy of the root one). The built packages currently carry the `License: MIT` metadata but no license file. Rebuild after adding it.

**Each release:**

```bash
cd integrations/django
python -m pip install --upgrade build twine
rm -rf dist build *.egg-info          # PowerShell: Remove-Item -Recurse -Force dist, build, *.egg-info
python -m build
python -m twine check dist/*
# optional dry run on TestPyPI, then install it from there in a fresh venv
python -m twine upload --repository testpypi dist/*
# the real upload: username __token__, password the API token
python -m twine upload dist/*
```

**After the first upload:**

- Check https://pypi.org/project/pointcast-django/ and install it in a fresh venv: `pip install pointcast-django`.
- In `integrations/django/README.md`, drop "Until the package is on PyPI, install it from this folder…"; update the r/django post's install line in [reddit.md](reddit.md).
- Later, instead of tokens: PyPI's *Trusted Publishing* from a GitHub Actions workflow (no secret stored). Not set up.
- Bump `version` in `integrations/django/pyproject.toml` for every upload: PyPI never accepts the same version twice, even after a deletion.
