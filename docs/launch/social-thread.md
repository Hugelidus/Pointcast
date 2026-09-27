# X / Bluesky thread

Same thread text works for both (trim to 300 chars per post for Bluesky if needed; X allows longer but shorter reads better).

---

**1/**
"Make *this* sortable and move *this* next to *that*" — that's how I actually talk about UI changes. My coding agent has no idea what "this" is.

So I built pointcast: Alt+click or select what you mean while you talk. It hands the agent the exact element.

🧵

**2/**
Press Record → talk about the change → Alt+click / select the element you mean → Stop.

pointcast transcribes your voice locally in the browser (Whisper, no audio leaves your machine), lines up the words with what you pointed at, copies a Markdown spec.

**3/**
```
## Request 1
> This [a] should be sortable by quantity.
- [a] th «Quantity» (selected) on `/index.html`
  - in: main › section#orders › table#orders-table › thead › tr › th[3]
```
Paste that into Claude Code / Cursor / any agent.

**4/**
Alt+click is cancelled before it hits the page (same convention as MCP Pointer) — pointing at "Delete" never deletes. Only Alt+click and text selection are captured; every other click passes straight through.

**5/**
Did it actually help, or is it just a nice demo? I ran an eval: 3 real open-source dashboards (React/Vue/Svelte), same spoken request with vs. without pointing.

Accuracy on picking the *right* element: 78% → 89%. Biggest gains exactly where two things look alike.

**6/**
A careful hand-written description still beats it (96%, fewer tokens) — expected. pointcast isn't trying to out-write a careful writer, it's removing the need to *be* one while you'd rather just point and talk.

Full numbers + failure cases: [link to docs/eval]

**7/**
Runs on localhost by default, nowhere else unless you opt a specific host in. Password fields and (on enabled sites) anything that looks like personal data are redacted at capture — verified by a canary test, not just a promise.

**8/**
MIT licensed, TypeScript, every non-obvious design call written down with what was rejected and why: [link to docs/decisions.md]

It's Phase 1 — Chrome only for now. Try it, break it, tell me where the pointing/transcription gets it wrong.

⭐ [GitHub link]
