# Show HN

Post as a link to the repository (`https://github.com/Hugelidus/pointcast`), then add the text below at once as the first comment. HN rules for Show HN: something people can try, no sign-up; no voting rings, no asking for upvotes anywhere.

## Title (under 80 characters)

```
Show HN: Pointcast – talk and Alt+click on your app; your agent gets the code
```

Alternates:

```
Show HN: Pointcast – point at your UI while talking, agents get the exact line
Show HN: Pointcast – narrate UI changes while pointing, transcribed locally
```

(77, 78 and 75 characters, counting the dash as one. Check again after any edit: HN cuts at 80.)

## First comment (by the author)

Hi HN, I'm the author. Pointcast is a Chrome/Edge extension plus a small local MCP server. You press Record, talk about the changes you want in your web app, and Alt+click the things you mean while you say them ("this should take you to the reports page", "and this button should export only the filtered orders"). At Stop, each sentence becomes a request, and each element you pointed at comes with the line of code behind it, so Claude Code, Codex, Gemini CLI or Cursor go straight to `src/pages/Dashboard.tsx:11` instead of searching the repo. 18-second video: https://github.com/Hugelidus/pointcast/blob/main/docs/launch/video/out/pointcast-demo.mp4

**Why.** I kept typing "make this sortable and move this next to that" into a coding agent and then writing a second message explaining which "this". A screenshot doesn't fix it: the agent needs the element and the file, not pixels. And a page often has two «Export» buttons or two identical cards, which is exactly where words fail.

**How it works.**

- Alt+click is cancelled before it reaches the page, so pointing at «Delete» never deletes. Plain clicks are never captured.
- Your voice is transcribed in the browser (Whisper base via transformers.js, in an MV3 offscreen document), while you record. There is a voice activity detector (Silero) in front of Whisper, because Whisper invents speech on silence: 15 s of room noise came out as "¡Adiós!", and one tester's recording had "de la" 430 times. Now silence gives no words.
- Words and gestures are aligned with a small dynamic-programming pass (greedy nearest-neighbour picks the wrong pairing when two "this" are close together).
- The code pointer comes from framework dev metadata (React 19, Vue 3, Svelte 5 dev builds), and for Django templates from a small dev-only package, `pointcast-django`, that marks each rendered template with HTML comments. A resolver then looks the element's text up in those few files. If the text is written more than once, it says nothing: a missing line costs the agent a search, a wrong line costs a wrong edit.
- Recordings go straight to the MCP server your agent already runs, on 127.0.0.1, with no downloads. The server only accepts the extension's origin, a custom header and content type, and checks `Host`, so a web page can't inject a recording.

Plugins: Claude Code (`/pointcast`), Codex CLI, Gemini CLI; Cursor/Windsurf through the MCP server; anything else by pasting the spec.

**Numbers, measured before writing this.**

- On three open-source admin dashboards (React, Vue, Svelte), the same spoken request with pointing vs. without: the agent picked the right element 89% vs. 78% of the time (40/45 vs. 35/45). A careful, hand-written description still did better (96%). https://github.com/Hugelidus/pointcast/blob/main/docs/eval/results-2026-09-27.md
- Adding the code lines cut the input tokens the agent spent finding the elements by more than half (93.7k → 39.9k per run, 44/45 correct), with zero searches before it opened the right file. https://github.com/Hugelidus/pointcast/blob/main/docs/eval/stage0-code-pointer-2026-09-27.md
- Django: on a real ~1,300-template Django + HTMX app, a read-only dry run placed ~94% of sampled on-screen elements on their exact template line, with 0 wrong; the rest stay silent. https://github.com/Hugelidus/pointcast/blob/main/docs/decisions.md#d9-source-mapping

Small samples (3 runs per condition, one model), and the code-pointer run used chains from a probe, not the shipped extension. The reports list their own limits; please read those before quoting me.

**Limits.**

- The code pointer needs a dev build (React 19, Vue 3, Svelte 5, or Django in DEBUG). Production builds, Angular, Rails and other server templates get the DOM description only (selector, path, text).
- Chrome and Edge on desktop. Firefox isn't supported yet. Developed on Windows; macOS and Linux should work, but I haven't tested them.
- Local dev hosts only by default (`localhost`, `*.test`…); any other site is a per-host opt-in.
- The first recording downloads the speech model once (294 MB).

MIT, no account, no server of mine. What I'd most like to hear: where the pointing or the transcription gets it wrong on your app, and which stack you'd want the code pointer for next (webpack/Next.js, Angular, Rails, Laravel, Jinja are on the list).

https://github.com/Hugelidus/pointcast

## Answers to have ready

- **"Why not just write a precise prompt?"** You should when you can: in the eval a careful written request beat pointing (96%). Pointcast is for when you'd rather talk and point than write that description. Against a realistic quickly-typed request, the code-pointer run got 44/45 vs. 35/45.
- **"Does my audio go anywhere?"** No. Whisper runs in the extension; the only network calls are the one-time model download (Hugging Face), your own dev server and your own MCP server on 127.0.0.1.
- **"Why an extension and not a Playwright/computer-use agent?"** The human is the one who knows which element they mean. The extension only captures what you point at.
- **"Other tools?"** MCP Pointer and react-grab send one element, without voice; screen-recording tools send pixels. The README has a comparison table.
