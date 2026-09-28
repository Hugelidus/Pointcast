# X / Bluesky thread

Seven posts, each under 300 characters so the same text works on Bluesky (X allows more, but short reads better). Attach the hero GIF (`docs/launch/video/out/pointcast-hero.gif`, 9.6 s) natively to post 1; both platforms autoplay it muted and a GIF that short loops before anyone scrolls past. Link the full video (`pointcast-demo.mp4`, ~27.5 s) in the last post for anyone who wants the whole loop. Plain text only (no backticks: neither platform renders Markdown). Links go in the last post only: posts with links get less reach on X, and the first post should be the video. Pin the thread to your profile for launch week.

---

**1/** (with the hero GIF)

"Make this sortable and move this next to that." That's how I talk about UI changes. My coding agent has no idea what "this" is.

So I built Pointcast: talk while you Alt+click your web app, and your agent gets the source line that makes the element — not its HTML.

**2/**

Press Record, talk (or type a note if you can't), Alt+click what you mean, press Stop.

Each sentence becomes a request. Each element comes with its code: «Export» → src/components/OrdersTable.tsx:22.

Voice is transcribed in the browser (Whisper). Nothing leaves your machine.

**3/**

Does pointing help, or is it a nice demo? I measured it on 3 open-source dashboards (React, Vue, Svelte).

Same spoken request, with vs. without pointing: the agent picked the right element 89% vs. 78% of the time.

A careful written prompt still won: 96%.

**4/**

Then the code lines: with file:line for each element, the tokens the agent spent finding them fell by more than half, and it opened the right file first.

Also on Django templates now: on a real ~1,300-template Django + HTMX app, ~94% of sampled elements on their exact line, 0 wrong.

**5/**

A real recording usually holds several changes. Six in one recording: 96% right code vs. 85% for the same six typed by hand — 24% fewer tokens, 75% fewer searches.

One change at a time is a bit more accurate (96% vs. 84%), just not cheaper.

**6/**

The rule behind it: when it isn't sure, it says nothing. A missing line costs the agent a search; a wrong one costs a wrong edit.

Newer: a typed mode for when you can't talk, and a setting that captures the console/network errors around each pointed element.

Limits: dev builds only, Chrome and Edge, a beta.

**7/**

Works with Claude Code (/pointcast), Codex CLI, Gemini CLI, Cursor and any MCP client. Free and MIT.

Tell me where it points at the wrong thing on your app.

github.com/Hugelidus/pointcast
Full video: github.com/Hugelidus/pointcast/blob/main/docs/launch/video/out/pointcast-demo.mp4
Evals: github.com/Hugelidus/pointcast/tree/main/docs/eval
