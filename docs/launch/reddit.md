# Reddit posts

One post per subreddit, each written for that community. They are drafts, not a submit button: read the sidebar rules the same day you post (they change), pick the flair the sub asks for, and stay in the thread for the first hours.

What the rules usually are, from memory, **not re-checked for this draft**:

- **r/ClaudeAI:** projects are welcome with the project flair (look for one like *Built with Claude* or *Showcase*); some flairs ask you to say how Claude was involved and whether the project is free. Pointcast is free and MIT; say it.
- **r/ChatGPTCoding:** tools are fine if you are open that it's yours and it's free; low-effort promotion is removed.
- **r/webdev:** your own projects go in **Showoff Saturday** posts only (Saturdays, with that flair). So the r/webdev post goes out on the first Saturday after launch, not on launch day.
- **r/django:** project posts are fine when they are useful to Django developers; lead with the Django part.

For every post: upload `docs/launch/video/out/pointcast-demo.mp4` (~27.5 s, no sound) as the post's video where the sub allows video, or put the link in the first line; the short hero GIF (`pointcast-hero.gif`, 9.6 s) is a fallback where a sub won't take video. Reddit prefers the video natively uploaded to a link to GitHub. Don't cross-post the same text on the same day; space them out (see [launch-plan.md](launch-plan.md)).

Links used below:

- Repository: https://github.com/Hugelidus/pointcast
- Video: https://github.com/Hugelidus/pointcast/blob/main/docs/launch/video/out/pointcast-demo.mp4
- Eval: https://github.com/Hugelidus/pointcast/blob/main/docs/eval/results-2026-09-27.md
- Code-pointer eval: https://github.com/Hugelidus/pointcast/blob/main/docs/eval/stage0-code-pointer-2026-09-27.md
- Django: https://github.com/Hugelidus/pointcast/tree/main/integrations/django

---

## r/ClaudeAI

**Title:** I made a Claude Code plugin that takes what you say while pointing at your app, and hands Claude the exact lines of code

**Body:**

The video shows the whole loop: talk, Alt+click two things, Stop, and each element comes with its line of code — not the HTML, the line that makes it.

I do a lot of UI work with Claude Code, and the most annoying part was the second message: "no, not that Export button, the one above the orders table". So I built Pointcast. You record yourself talking about the changes while you Alt+click the elements you mean (or type a short note instead, if you'd rather not talk). At Stop, the extension transcribes your voice in the browser (Whisper, nothing leaves your machine) and hands the recording straight to the plugin's MCP server. Then `/pointcast` in Claude Code fetches it:

```markdown
## Request 2
> And this [a] button should export only the filtered orders.
- [a] «Export» → code:
  - text at: `src/components/OrdersTable.tsx:22`
```

Install:

```bash
claude plugin marketplace add Hugelidus/pointcast && claude plugin install pointcast@pointcast
```

plus the Chrome/Edge extension (the Chrome Web Store listing is in review; the release zip works meanwhile).

**Does it help, or is it just a nice demo?** I measured it with `claude -p` (Sonnet) on three open-source admin dashboards: with pointing, Claude picked the right element 89% of the time, against 78% with the same words and no pointing. A careful hand-written prompt still beats it on accuracy for a single change (96%): Pointcast is for when you'd rather talk and point than write that prompt. Where it does pay off is a real recording with several changes: read through the MCP server, six changes in one recording got the right code 96% of the time against 85% for the same six changes typed by hand, with 24% fewer tokens and 75% fewer searches. Reports, with their limits: [eval](https://github.com/Hugelidus/pointcast/blob/main/docs/eval/results-2026-09-27.md), [code pointer](https://github.com/Hugelidus/pointcast/blob/main/docs/eval/stage0-code-pointer-2026-09-27.md), [batching](https://github.com/Hugelidus/pointcast/blob/main/docs/eval/results-2026-09-28-batching.md).

How Claude was involved: I built it with Claude Code, and the evaluation runs Claude as the agent under test.

Limits: code lines need a dev build (React 19, Vue 3, Svelte 5, Django in DEBUG); Chrome and Edge only; tested on Windows.

It's free and MIT, a beta. I'd like to know where it picks the wrong element or mishears you, on your own app.

https://github.com/Hugelidus/pointcast

---

## r/ChatGPTCoding

**Title:** Pointing beat describing: a local tool that turns "this button" into the file and line for your coding agent (with eval numbers)

**Body:**

Video (~27.5 s): https://github.com/Hugelidus/pointcast/blob/main/docs/launch/video/out/pointcast-demo.mp4

Most of my UI prompts are deictic: "make this sortable", "move this next to that". Agents can't see "this". I built Pointcast (free, MIT, my project): a Chrome/Edge extension where you talk (or type a note, if you'd rather) while you Alt+click the elements you mean. At Stop you get one request per sentence, with each element's code location (`src/components/OrdersTable.tsx:22`) on React 19, Vue 3 and Svelte 5 dev builds and Django templates — the source line that makes the element, not its HTML.

It works with whatever agent you use:

- Codex CLI: `codex plugin marketplace add Hugelidus/pointcast && codex plugin add pointcast@pointcast`
- Gemini CLI: `gemini extensions install https://github.com/Hugelidus/pointcast`
- Claude Code: plugin, `/pointcast`
- Cursor / Windsurf / any MCP client: `npx -y pointcast@0.5 mcp`
- Anything else: paste the spec from the clipboard

What I measured (three open-source dashboards, 45 changes, same agent and prompt, only the request differs):

| Request the agent got | Right element | Input tokens per run |
|---|---|---|
| Spoken words, no pointing | 78% | 105k |
| Spoken words + pointing | 89% | 97k |
| Pointing + code lines | 98% (44/45) | 40k |
| Careful hand-written description | 96% | 65k |

The code-lines row is a second run of the same harness on the same apps (pointing without code lines got 43/45 and 94k there), with code chains taken by a probe rather than the shipped extension, so read it as indicative; the reports say what they can and can't show ([eval](https://github.com/Hugelidus/pointcast/blob/main/docs/eval/results-2026-09-27.md), [code pointer](https://github.com/Hugelidus/pointcast/blob/main/docs/eval/stage0-code-pointer-2026-09-27.md)). Small samples, one model (Sonnet).

A follow-up ran the whole product end to end (typed notes, the MCP server, four apps including Django) with a recording of six changes at once: reading it through the MCP server got the right code 96% of the time against 85% for the same six changes typed by hand, at 24% fewer input tokens and 75% fewer searches. With one change per request it is still more accurate (96% vs. 84%), but not cheaper — the saving is in batching. In wall-clock terms, my rough estimate (not measured) for six UI changes is ~15 min asking one by one vs. ~5 min with one 2-minute recording; the accuracy and token numbers above are measured. [Full results](https://github.com/Hugelidus/pointcast/blob/main/docs/eval/results-2026-09-28-batching.md).

Voice is transcribed locally in the browser (Whisper, with a voice activity detector so silence doesn't turn into invented sentences). Recordings go to a local MCP server, no cloud.

Feedback welcome, especially failures: what did it point at, and what should it have said?

https://github.com/Hugelidus/pointcast

---

## r/webdev (Showoff Saturday)

**Title:** [Showoff Saturday] Alt+click elements of your dev app while you talk; you get a spec with each element's line of code

**Body:**

Video (~27.5 s): https://github.com/Hugelidus/pointcast/blob/main/docs/launch/video/out/pointcast-demo.mp4

Pointcast is a Chrome/Edge extension for your local dev server. You record your voice (or switch to Typed mode and write a short note per element instead), Alt+click or select the elements you're talking about, and at Stop you get a Markdown spec: one request per sentence, each with the elements you pointed at and where they live in your source. It's meant for handing UI changes to a coding agent, but the spec reads fine for a human too.

Some implementation details this sub might like:

- **Where the line comes from.** React 19, Vue 3 and Svelte 5 expose component info in dev builds; the extension reads it, then fetches the component files from your Vite dev server (`/src/…?raw`, in memory, 2 s budget) and looks the element's text up in them. If the text is written more than once, it adds nothing. A wrong line is worse than no line, and a library's own code (Radix, shadcn/ui primitives) is skipped rather than resolved as if it were yours.
- **Pointing never touches your app.** Alt+click is cancelled before the page sees it; plain clicks pass straight through and are never recorded.
- **Privacy.** Local dev hosts only by default; other hosts are opt-in one at a time. Password and one-time-code fields are never captured, attributes come from an allowlist, and a canary test checks it.
- **Whisper in an MV3 extension.** transformers.js in an offscreen document, with WASM threads (needs cross-origin isolation) and the ONNX runtime shipped in the package, since MV3 forbids remote code.
- **Debug capture.** While recording, it also keeps the console errors and failed requests around the moment you pointed (a setting), so "this button does nothing" comes with the 500 or the exception that caused it.

Limits: dev builds only for the code lines. With webpack or Next.js the pasted spec has the component chain but no line (the local MCP server still resolves it from your repo). Chromium only; macOS and Linux untested.

Free, MIT. I'd love to hear where it breaks on your stack.

https://github.com/Hugelidus/pointcast

---

## r/django

**Title:** A dev-only Django app that makes the template name and line of any element on your page available to your coding agent

**Body:**

If you use a coding agent (Claude Code, Codex, Cursor…) on a Django project, you know the first step of every UI change: the agent greps for the template. On a project with hundreds of templates, includes and HTMX partials, that's slow and sometimes lands on the wrong one.

`pointcast-django` is a small, dev-only app for Pointcast, a browser extension where you talk while you Alt+click elements of your page. With it, the element comes with its template and the line its text is on:

```text
- [a] «Archivar» → code:
  - template: `templates/pim/partials/row.html`
  - text at: `templates/pim/partials/row.html:5` — `<td><button hx-post="/pim/{{ product.sku }}/archive/" …>Archivar</button></td>`
  - within: template `templates/pim/list.html` ← template `templates/base.html`
```

Setup is one line:

```python
if DEBUG:
    INSTALLED_APPS += ["pointcast_django"]
```

How it works: while `DEBUG` is on, it wraps each project template's HTML output in two HTML comments naming the template (pages, `{% include %}`, blocks from `{% extends %}`, HTMX partials). It hooks `Template.compile_nodelist` and `BlockNode.render`; no middleware, no template edits. It never runs with `DEBUG` off, never touches JSON, text emails, attributes or `<title>`, never names templates outside your project, and never writes an absolute path. The tests check that the output is otherwise byte-identical to Django's.

On a real ~1,300-template Django + HTMX app, a read-only dry run placed ~94% of sampled on-screen elements on their exact template line, with none wrong. The rest (text written twice in the same template, for example) get no line rather than a guess.

Not covered yet: Jinja2 templates, and text built in views or translated with a msgid that differs from what's rendered. Django 4.2+.

Install from the repo for now (`pip install "git+https://github.com/Hugelidus/pointcast#subdirectory=integrations/django"`; PyPI soon). Free, MIT.

I'd like feedback from people with bigger or odder template setups: custom loaders, django-cotton, django-components, template fragments.

Details: https://github.com/Hugelidus/pointcast/tree/main/integrations/django · video (React example, same idea): https://github.com/Hugelidus/pointcast/blob/main/docs/launch/video/out/pointcast-demo.mp4
