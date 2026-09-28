# Ideas backlog

Ideas worth exploring after Phase 1. Not commitments: each needs a decision entry in [decisions.md](decisions.md) before it is built.

## Next up (noted 2026-09-27, after the full evaluation)

**Evaluation baseline M2 is an upper bound, not a realistic alternative.** The "careful written request" in `dev/eval/scenarios/*/M2.md` was written by the agent that designed the scenarios, knowing every ambiguity, so it names exactly the disambiguating detail ("la cuarta de las tarjetas de arriba, la de +573", "borra la segunda, la de barras horizontales"). Its 96 % is a ceiling, close to an oracle. Fix the wording in `docs/eval/results-2026-09-27.md` and the README (call it an upper bound), and add **M3, a realistic typed request**: written without knowing the traps, as a developer types into Claude Code in a hurry, ideally by real people with a stopwatch (also measures the user's time: ~30 s speaking vs minutes writing), otherwise by several independent agents with a word limit. About 9 more `claude -p` runs.

**Spec quality issues seen in a real session (flowbite eval recording):**
- `component` points into `node_modules` (library components such as `TabItem`, `Heading`, `P`), which the agent must not edit. Walk up to the nearest component in the app's own source (Vue and Svelte expose the parent chain; React the owner). Likely the biggest token lever: today this hint sends the agent nowhere.
- `styles` is verbose (`oklch(…)` colors, `129.422px` widths): round, drop defaults, or show only for visual requests.
- Requests with no elements ("A ver, unos cambios en la portada", "Eso es todo") are noise: fold them into a one-line intro or drop them.
- Trivial search hints such as `href #top` should be filtered out.
- Div-based card titles (shadcn, MUI, Ant) are not read as card context yet.

## After the handoff to a running MCP server (noted 2026-09-28)

Left out of [D11](decisions.md#d11-handoff-to-a-running-mcp-server) on purpose:
- **Show in folder for handed-off sessions.** `downloads.show` only reveals Chrome's own downloads, and an extension cannot open a path, so the popup names the folder instead. A "reveal" endpoint on the receiver could open it, but an HTTP request would then start `explorer.exe` (or `open`, `xdg-open`) inside the agent's MCP process: more attack surface for a secondary button.
- **Several sessions folders.** Servers started with different `--dir` all read their own folder, but a recording lands only in the receiving server's. Delivering to every running server's folder would need discovery and several receivers.
- **Shared multi-user machines.** Loopback is shared by every OS user, so another user can post a session to your server, or receive yours while it is down. A peer-uid check on Linux (the connecting socket's owner), or native messaging (a host manifest the user installs, with no port at all), would close that.

## GitHub issues from a recording (parked 2026-09-27)

`pointcast issue` (CLI) can already file the spec as an issue with permalinks to the resolved lines, but a raw spec is not a good issue for a human reader. Before promoting it, pass the spec through an LLM that writes a proper issue (title, short summary, one checklist item per request with its code links, acceptance criteria), keeping the code pointers intact. Parked because v1's goal is narrower: save the user's time and the agent's tokens by turning speech into a spec that points at the right code.

## Element screenshots (deferred)

*Discussed 2026-09-27.* Automatic cropped screenshots per pointed element were considered and deferred. The pilot evaluation (docs/eval/pilot-2026-09-27.md) shows the agent already identifies every element from the text spec, so screenshots would not help identification. They would only help visual requests ("misaligned", "this icon is unclear"), at the cost of latency (Chrome allows 2 captures per second), tokens and privacy (they capture whatever is on screen). Key computed styles in text cover most visual requests first. Revisit as an opt-in "visual feedback" mode if the full evaluation shows it improves results for layout-type requests.

## Referring-expression detector instead of a fixed deictic list

*Proposed 2026-09-26.*

Fusion (D4) anchors gestures to a fixed list of deictic words ("esto", "aquí", "this"…). Real narration refers to elements in richer ways: "the blue button", "la barra de arriba", "that column over there". A small, fast local model could decide, per word or phrase, whether it refers to something visual, and give fusion better anchor candidates (with a confidence to use as a cost in the alignment).

Evidence from the first real recording (2026-09-26, playground):
- **The noun after a deictic names the intended element type.** "esta tabla" was said while clicking header cells (`th`); "esta barra" matched the `header`. Mapping nouns to roles (tabla→table, fila→tr, columna→column of th/td, botón→button, barra→header/nav/toolbar, texto→p, campo→input, enlace→a, menú→nav/menu, título→h1–h6) would let fusion describe the intended ancestor instead of the clicked cell.
- **Words often repeat the element's own text.** "Los settings…" was said while pointing at the «Settings» heading, and "ordenada por cantidad" while pointing at «Quantity». Lexical (and translated) matching between transcript words and captured element texts would give strong anchors even without a deictic, and would have placed the Quantity marker next to "cantidad" instead of "esté".

Open questions:
- Which model: a tiny text classifier over the transcript, or a model that also sees the captured elements' texts (so "el botón de save" matches the element «Save»)?
- Latency and size budget: it must not noticeably slow down `pointcast process` or bloat the install.
- How to evaluate: a labelled set of real narrations with the gestures that belong to each phrase.
