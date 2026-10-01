# Show HN

Post as a link to the repository (`https://github.com/Hugelidus/pointcast`), then add the text below at once as the first comment. Before posting: the Chrome Web Store listing is **Public**, the README's first screen shows the GIF and the store link, and you can stay in the thread for the next 2–3 hours.

HN rules for Show HN: something people can try, no sign-up; no voting rings, no asking for upvotes anywhere (not even friends). Best window: Tuesday to Thursday, 15:00–17:00 Spain (9–11 am US East).

## Title (under 80 characters)

```
Show HN: Pointcast – talk and Alt+click your web app; agents get the code lines
```

Alternates:

```
Show HN: Pointcast – point at your UI and talk; your coding agent gets the lines
Show HN: Pointcast – review your web app by voice, agents get the exact code
```

(79, 80 and 76 characters, counting the dash as one. Check again after any edit: HN cuts at 80.)

## First comment (by the author)

Hi HN, I'm the author. I built Pointcast because, coding with agents, I spent half my time writing things like "the button on the right… no, the other one, in the card below". The agent can't see what "this" is, and a screenshot gives it pixels, not the file.

Pointcast is a Chrome/Edge extension plus a small local MCP server. You press Record, talk through the changes you want in your web app (or type a short note per element if you'd rather not talk), and Alt+click the things you mean while you say them. At Stop, each sentence becomes a request, and each element you pointed at comes with the line of code behind it — not the HTML, the source line — so Claude Code, Codex, Gemini CLI or Cursor go straight to `src/pages/Dashboard.tsx:11` instead of searching the repo. With the plugins, `/pointcast watch` makes the agent pick up each recording as soon as you press Stop: you just keep reviewing your app.

**The number I care about most.** Ten UI changes on a real React app (a mix of tweaks and new things: a hover preview, rotating quotes, a themed progress bar, a profile menu…). Giving them as one Pointcast recording took 1.5 min; writing them as one careful prompt took me 15–20 min. Same agent, same commit. In a blind review of the three results (screenshots of every change plus the diffs, versions labelled X/Y/Z), the recording scored 192/200 and the hand-written prompt 174. That's one run of each, reviewed by an AI model, so read it as a direction, not a margin. Methods and limits: https://github.com/Hugelidus/pointcast/blob/main/docs/eval/results-2026-09-29-instruction-style.md

The same experiment taught me something: the spec used to tell the agent "change only the referenced elements, and only as asked". With that line, the same recording scored 146 — the agent did the literal minimum on anything new. Now the spec says the elements say *where*, and a request for something new should be built properly in the app's style. "Change only what I point at" is still one setting away for strict edits.

**How it works.**

- Alt+click is cancelled before it reaches the page, so pointing at «Delete» never deletes. Plain clicks are never captured.
- Your voice is transcribed in the browser (Whisper via transformers.js, in an MV3 offscreen document), while you record, with a voice activity detector in front because Whisper invents speech on silence. Fast (whisper-base) or Accurate (whisper-small).
- Words and clicks are aligned by time: a click belongs to the word you were saying, and a click just before you start talking joins that sentence.
- The code pointer comes from framework dev metadata: React (on Vite, including React 19 through the dev server's source maps, and Next.js App Router), Vue 3, Svelte 5, and Django templates through a small dev-only package. A resolver then finds the element's text or data line in those files. If it's ambiguous, it says nothing: a missing line costs the agent a search, a wrong line costs a wrong edit.
- Several copies of one component (rows of a list) are grouped into one entry; you can point inside SVG charts and maps.
- Recordings go to the MCP server your agent already runs, on 127.0.0.1, with no downloads. The server only accepts the extension's origin and checks `Host`, so a web page can't inject a recording.

**Limits.** The code pointer needs a dev build; production builds, Angular, webpack-only React and server templates other than Django get the DOM description only (selector, path, text). Chrome and Edge on desktop; CI runs the end-to-end tests on Windows, macOS and Linux. The first recording downloads the speech model once (294 MB). Local dev hosts only by default; any other site is a per-host opt-in.

MIT, no account, no server of mine: https://github.com/Hugelidus/pointcast · Chrome Web Store: https://chromewebstore.google.com/detail/pointcast/hliijcklkpbddgjhkifjeggidghbbboa

What I'd most like to hear: where the pointing or the transcription gets it wrong on your app, and which stack you'd want the code pointer for next.

## Answers to have ready

- **"Why not just write a precise prompt?"** You can, and it works: in the experiment the careful prompt was good (174/200). It took 15–20 min to write, though, against 1.5 min of talking and clicking, and it still had to describe *where* each thing was. Most people don't write prompts that precise; they ask one change at a time, which the earlier batching evaluation found costs about 2.5× the tokens.
- **"n = 1?"** Yes, for the blind review. The recording is automated (a TTS voice and scripted clicks), so it's repeatable; more runs are planned and will go in the same file.
- **"Does my audio go anywhere?"** No. Whisper runs in the extension; the only network calls are the one-time model download (Hugging Face), your own dev server and your own MCP server on 127.0.0.1.
- **"Why not let the agent look at the page itself (Playwright, computer use)?"** It can see the page, but it doesn't know which element *you* mean, and browsing costs a lot of context. You're the one who knows; Pointcast captures exactly what you point at.
- **"Other tools?"** Stagewise (a browser toolbar and its own agent IDE), React Grab (copy one React element's context), MCP Pointer (one element over MCP). Pointcast's angle: a whole review in one recording, by voice or typed, resolved to source lines across React, Vue, Svelte and Django, with any MCP agent.
- **"Why Chrome only?"** MV3 offscreen documents and local Whisper; Firefox is an open issue (help welcome).
