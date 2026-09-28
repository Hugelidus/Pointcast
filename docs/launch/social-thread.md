# X / Bluesky thread

Six posts, each under 300 characters so the same text works on Bluesky (X allows more, but short reads better). Attach the 18 s video (`docs/launch/video/out/pointcast-demo.mp4`) natively to post 1; both platforms autoplay it muted. Plain text only (no backticks: neither platform renders Markdown). Links go in the last post only: posts with links get less reach on X, and the first post should be the video. Pin the thread to your profile for launch week.

---

**1/** (with the video)

"Make this sortable and move this next to that." That's how I talk about UI changes. My coding agent has no idea what "this" is.

So I built Pointcast: talk while you Alt+click your web app, and your agent gets the exact elements and the lines of code behind them.

**2/**

Press Record, talk, Alt+click what you mean, press Stop.

Each sentence becomes a request. Each element comes with its code: «Export» → src/components/OrdersTable.tsx:22.

Voice is transcribed in the browser (Whisper). Nothing leaves your machine.

**3/**

Does pointing help, or is it a nice demo? I measured it on 3 open-source dashboards (React, Vue, Svelte).

Same spoken request, with vs. without pointing: the agent picked the right element 89% vs. 78% of the time.

A careful written prompt still won: 96%.

**4/**

Then the code lines: with file:line for each element, the tokens the agent spent finding them fell by more than half, and it opened the right file first.

New in 0.3, Django templates: on a real ~1,300-template Django + HTMX app, ~94% of sampled elements on their exact line, 0 wrong.

**5/**

The rule behind it: when it isn't sure, it says nothing. A missing line costs the agent a search; a wrong one costs a wrong edit.

Limits: dev builds only (React 19, Vue 3, Svelte 5, Django), Chrome and Edge, a beta.

**6/**

Works with Claude Code (/pointcast), Codex CLI, Gemini CLI, Cursor and any MCP client. Free and MIT.

Tell me where it points at the wrong thing on your app.

github.com/Hugelidus/pointcast
Evals: github.com/Hugelidus/pointcast/tree/main/docs/eval
