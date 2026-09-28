// The short clips for the README, each a pure function of time like timeline.js: renderAt(t) draws
// the instant t of the clip named by ?clip= (hero, typed, batch, mcp, errors), and renderAt(DURATION)
// looks exactly like renderAt(0), so every GIF loops without a seam. The hero's first frame is its
// point (the jump: not the HTML, the line that makes it), since GitHub shows it before the GIF loads.
//
// The specs are the real rendering (packages/core renderMarkdown) of these gestures, resolved against
// dev/examples/react-dashboard, abridged like the demo's: the lines shown are verbatim, some left out.
"use strict";

const { clamp, prog, inOut, out, outQuint, escapeHtml, setStyle: style, Jump } = window.PC;
const mix = (a, b, p) => a + (b - a) * p;
const back = (x) => { const c1 = 1.3, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
/** Fades in over [a, a+din] and out over [b, b+dout]. */
const span = (t, a, b, din = 0.3, dout = 0.3) => Math.min(out(prog(t, a, a + din)), 1 - inOut(prog(t, b, b + dout)));
const $ = (id) => document.getElementById(id);

const CLIP = new URLSearchParams(location.search).get("clip") ?? "hero";
const SRC = "../../../dev/examples/react-dashboard/src/";
const ICON = "../../../dev/scripts/icon/pointcast.svg";

// ---------------------------------------------------------------- pieces (markup)

/** dev/examples/react-dashboard, rebuilt from its source with its own CSS (as in index.html). */
const APP = `
<div class="app">
  <nav class="sidebar" aria-label="Main">
    <div class="sidebar-brand">Acme Store</div>
    <ul class="nav-list">
      <li><a class="nav-item nav-item-active"><span>Dashboard</span></a></li>
      <li><a class="nav-item"><span>Orders</span></a></li>
      <li><a class="nav-item"><span>Customers</span></a></li>
      <li><a class="nav-item"><span>Messages</span><span class="badge" id="t-badge">3</span></a></li>
      <li><a class="nav-item"><span>Settings</span></a></li>
    </ul>
  </nav>
  <main class="content">
    <header class="header-bar"><h1 id="t-title">Dashboard</h1><div class="header-actions"><span class="header-user">Ana Ríos</span></div></header>
    <div class="stat-grid">
      <section class="stat-card"><h3>Revenue</h3><p class="stat-subtitle">Last 30 days</p><p class="stat-value">$12,340</p><a class="stat-link" id="t-report">View report</a></section>
      <section class="stat-card"><h3>Orders</h3><p class="stat-subtitle">Last 30 days</p><p class="stat-value">128</p><a class="stat-link">View report</a></section>
    </div>
    <section class="chart-card"><h3>Sales this week</h3><svg class="sales-chart" id="chart" viewBox="0 0 378 120"></svg></section>
    <section class="panel" id="t-panel">
      <div class="panel-toolbar"><h2>Orders</h2><button type="button" class="btn btn-export" id="t-export">Export</button></div>
      <table class="data-table">
        <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th id="t-status">Status</th></tr></thead>
        <tbody>
          <tr><td>A-1042</td><td>Lina Torres</td><td>$128.00</td><td>Paid</td></tr>
          <tr><td>A-1041</td><td id="t-marco">Marco Peña</td><td>$64.50</td><td>Pending</td></tr>
          <tr><td>A-1040</td><td>Sofía Ibarra</td><td>$212.00</td><td>Paid</td></tr>
          <tr><td>A-1039</td><td>Diego Farfán</td><td>$39.90</td><td>Refunded</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</div>`;

const WEEKLY_SALES = [32, 48, 40, 65, 54, 72, 61]; // src/components/SalesChart.tsx

function browserHTML({ x, y, w, h }, done = "Copied · sent to your agent") {
  return `
<div id="browser" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px">
  <div class="bar">
    <div class="dots"><i></i><i></i><i></i></div>
    <div class="url"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#7a7596" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4M8 4.8v.1" stroke-linecap="round"/></svg>127.0.0.1:5174</div>
    <div class="ext"><img src="${ICON}" alt=""></div>
  </div>
  <div class="viewport" style="height:${h - 46}px">
    ${APP}
    <div class="pill rec" id="pill-rec"><span class="dot"></span>REC</div>
    <div class="pill rec" id="pill-notes"><span class="dot"></span>Notes</div>
    <div class="pill done" id="pill-done"><span class="glyph">✓</span>${done}</div>
  </div>
</div>`;
}

const MIC = `<svg width="13" height="16" viewBox="0 0 12 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="1" width="6" height="9" rx="3"/><path d="M1 8a5 5 0 0 0 10 0M6 13v2"/></svg>`;
const bubbleHTML = (id) => `<div class="bubble" id="${id}"><div class="tail"></div><div class="who">${MIC}You say<span class="wave"><i></i><i></i><i></i><i></i></span></div><div class="said" id="${id}-said"></div></div>`;

const POINTER = `
<div class="ripple" id="ripple"></div>
<div id="altkey"><span class="key">Alt</span></div>
<svg id="cursor" viewBox="0 0 20 28" aria-hidden="true"><path d="M1.5 1.5v21l5.2-5 3.6 8.3 3.6-1.6-3.6-8.1h7.2z" fill="#fff" stroke="#120f2d" stroke-width="1.6" stroke-linejoin="round"/></svg>
<div id="stopkeys"><b>Stop</b><span class="key">Alt</span><span class="plus">+</span><span class="key">Shift</span><span class="plus">+</span><span class="key">S</span></div>`;

const header = (step, title) => `<div class="hdr" id="hdr"><span class="step">${step}</span><h1>${title}</h1></div><div class="brand" id="brand"><img src="${ICON}" alt=""><span>Pointcast</span></div>`;

/** A spec card: `lines` are HTML (null for a gap); ids s0, s1… in order. */
function specHTML(id, head, lines, { x, y, w, fs = 24, lh = 40 }) {
  let n = 0;
  const body = lines.map((l) => (l === null ? '<div class="gap"></div>' : `<div class="ln" id="${id}-${n++}">${l}</div>`)).join("");
  return `<div class="specbox" id="${id}" style="left:${x}px; top:${y}px; width:${w}px; --fs:${fs}px; --lh:${lh}px"><div class="doc-head"><span class="ok">✓</span>${head}</div><div class="spec">${body}</div></div>`;
}
const loc = (s) => `<span class="loc">${s}</span>`;
const mk = '<span class="mk2">[a]</span>';

// ---------------------------------------------------------------- pieces (layout and drawing)

const L = {};

function rectOf(el) {
  const s = $("stage").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, cx: r.left - s.left + r.width / 2, cy: r.top - s.top + r.height / 2 };
}

function buildChart() {
  const max = Math.max(...WEEKLY_SALES);
  $("chart").innerHTML = WEEKLY_SALES.map((v, i) => { const h = (v / max) * 120; return `<rect class="chart-bar" x="${i * 54}" y="${120 - h}" width="40" height="${h}"/>`; }).join("");
}

/**
 * Shows the app at `zoom` with the app point (ox, oy) at the viewport's top left; with `fit`, frames
 * that element: as wide as the viewport allows (less `margin`), centred vertically.
 */
function frameApp({ zoom, ox = 0, oy = 0, fit, margin = 36, top }) {
  const app = document.querySelector(".app");
  const vp = document.querySelector("#browser .viewport");
  if (fit) {
    app.style.transform = "none";
    const a = app.getBoundingClientRect();
    const r = $(fit).getBoundingClientRect();
    zoom = (vp.clientWidth - 2 * margin) / r.width;
    ox = r.left - a.left - margin / zoom;
    oy = top === undefined ? r.top - a.top + r.height / 2 - vp.clientHeight / 2 / zoom : r.top - a.top - top / zoom;
  }
  app.style.transform = `translate(${(-ox * zoom).toFixed(2)}px, ${(-oy * zoom).toFixed(2)}px) scale(${zoom})`;
}

/** Stop keys above the pill, at the browser's bottom right. */
function placeStopKeys() {
  const b = rectOf($("browser"));
  const sk = $("stopkeys");
  L.stopkeys = { x: b.x + b.w - 24 - sk.offsetWidth, y: b.y + b.h - 24 - 60 - 18 - sk.offsetHeight };
}

/** A bubble beside a target: "right" of it (tail left) or "above" it (tail down, near its left). */
function placeBubble(id, target, side) {
  const b = $(id);
  const bw = b.offsetWidth, bh = b.offsetHeight;
  const tail = b.querySelector(".tail").style;
  if (side === "right") {
    Object.assign(b.style, { left: `${target.x + target.w + 30}px`, top: `${target.cy - bh / 2 - 6}px` });
    Object.assign(tail, { left: "-10px", top: `${bh / 2 - 5}px` });
    b.style.transformOrigin = "0 50%";
  } else {
    const left = Math.min(target.x - 24, 1600);
    Object.assign(b.style, { left: `${left}px`, top: `${target.y - 26 - bh}px` });
    Object.assign(tail, { left: `${target.cx - left - 11}px`, bottom: "-10px" });
    b.style.transformOrigin = `${target.cx - left}px 100%`;
  }
  void bw;
}

function buildWords(id, text) {
  const words = text.split(" ");
  $(`${id}-said`).innerHTML = words.map((w, i) => `<span>${escapeHtml(w)}</span>${i < words.length - 1 ? " " : ""}`).join("");
}

/** A bubble that opens at `at`, types its words from `from` (one every `step` s) and closes at `end`. */
function drawBubble(t, id, at, from, step, end) {
  const b = $(id);
  const pin = back(prog(t, at, at + 0.3));
  style(b, span(t, at, end, 0.2, 0.25), `scale(${0.85 + 0.15 * pin})`);
  const words = b.querySelectorAll(".said span");
  words.forEach((w, i) => { w.style.opacity = out(prog(t, from + i * step, from + i * step + 0.12)).toFixed(3); });
  const lastWord = from + (words.length - 1) * step + 0.2;
  const k = t >= from - 0.05 && t <= lastWord ? Math.min(1, (t - from + 0.05) / 0.12, (lastWord - t) / 0.12) : 0;
  [...b.querySelectorAll(".wave i")].forEach((bar, i) => {
    const v = 0.5 + 0.5 * Math.sin(t * (13 + i * 3.1) + i * 1.7);
    bar.style.transform = `scaleY(${(0.22 + k * 0.78 * (0.3 + 0.7 * v)).toFixed(3)})`;
  });
}

/** The cursor along arcs: `moves` = [[t0, t1, {x, y}], …] from `start`. */
function cursorAt(t, start, moves) {
  let from = start;
  for (const [a, b, to] of moves) {
    if (t < a) return from;
    if (t <= b) {
      const e = inOut(prog(t, a, b));
      const bend = 60;
      const c = { x: (from.x + to.x) / 2 + bend, y: (from.y + to.y) / 2 - bend * 0.6 };
      const u = 1 - e;
      return { x: u * u * from.x + 2 * u * e * c.x + e * e * to.x, y: u * u * from.y + 2 * u * e * c.y + e * e * to.y };
    }
    from = to;
  }
  return from;
}

/** Where to point at an element: a little right of its middle. */
const aim = (r, fx = 0.55) => ({ x: r.x + r.w * fx, y: r.cy + 3 });

/**
 * The cursor, its Alt key, the capture flash on each Alt+click target, the ripple.
 * clicks: [{ t, alt, flash }] (flash: id of the flash box, for an Alt+click).
 */
function drawPointer(t, { start, moves, clicks, show }) {
  const cur = cursorAt(t, start, moves);
  const press = (c) => { const d = t - c; return d < -0.08 || d > 0.2 ? 0 : d < 0 ? (d + 0.08) / 0.08 : 1 - d / 0.2; };
  const pressing = Math.max(0, ...clicks.map((c) => press(c.t)));
  style($("cursor"), show, `translate(${cur.x - 2}px, ${cur.y - 2}px) scale(${1 - 0.14 * pressing})`);
  const alts = clicks.filter((c) => c.alt);
  const altOp = Math.max(0, ...alts.map((c) => span(t, c.t - 0.4, c.t + 0.35, 0.18, 0.2)));
  style($("altkey"), Math.min(altOp, show), `translate(${cur.x + 26}px, ${cur.y + 30}px)`);
  $("altkey").firstElementChild.classList.toggle("down", alts.some((c) => Math.abs(t - c.t) < 0.12));
  for (const c of alts) {
    const d = t - c.t, dur = 0.75;
    style($(c.flash), d < 0 || d > dur ? 0 : d < dur * 0.6 ? 1 : 1 - (d - dur * 0.6) / (dur * 0.4));
  }
  const last = [...clicks].reverse().find((c) => t >= c.t) ?? clicks[0];
  const r = prog(t, last.t, last.t + 0.55);
  style($("ripple"), r <= 0 || r >= 1 ? 0 : 1 - r, `translate(${cur.x}px, ${cur.y}px)`);
  $("ripple").style.setProperty("--s", (0.2 + 0.8 * out(r)).toFixed(3));
}

function placeFlash(id, r) {
  const f = document.createElement("div");
  f.className = "flash";
  f.id = id;
  Object.assign(f.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  $("stage").insertBefore(f, $("ripple"));
}

function drawStop(t, at, pressAt, gone) {
  style($("stopkeys"), span(t, at, gone, 0.25, 0.25), `translate(${L.stopkeys.x}px, ${L.stopkeys.y + 10 * (1 - out(prog(t, at, at + 0.3)))}px)`);
  const down = t >= pressAt && t < pressAt + 0.16;
  for (const k of $("stopkeys").querySelectorAll(".key")) k.classList.toggle("down", down);
}

/** A pill that is there from `a` (0: from the start) to `b` (99: to the end); it pops in, then fades. */
function drawPill(t, id, a, b) {
  const pin = a <= 0 ? 1 : out(prog(t, a, a + 0.2));
  const pout = b >= 99 ? 0 : inOut(prog(t, b, b + 0.15));
  style($(id), Math.min(pin, 1 - pout), `scale(${a <= 0 ? 1 : 0.9 + 0.1 * back(prog(t, a, a + 0.3))})`);
}

/** Spec lines coming in one after another from `at`, every `step` s. */
function drawSpecLines(t, id, at, step) {
  document.querySelectorAll(`#${id} .ln`).forEach((ln, i) => {
    const p = out(prog(t, at + i * step, at + i * step + 0.3));
    style(ln, p, `translateX(${(-12 * (1 - p)).toFixed(2)}px)`);
  });
}

// ---------------------------------------------------------------- the clips

const CLIPS = {};

/**
 * Hero (9.6 s): the jump, held (the first frame); the browser: Alt+click «Marco Peña» saying
 * "This should link to the customer page.", Stop; the spec's request; the jump again: the cell's
 * HTML struck out, an arrow to OrdersTable.tsx:10, the ORDERS row that holds the name.
 */
CLIPS.hero = {
  size: [1600, 900],
  duration: 9.6,
  keys: { "hero-1-jump": 0.2, "hero-2-point": 3.1, "hero-3-spec": 5.3, "hero-4-strike": 6.5 },
  T: {
    fOut: 1.3, browserIn: 1.45, cursorIn: 1.95, move: [2.0, 2.55], click: 2.68, bubble: 2.3, words: 2.52, wordStep: 0.13,
    stopKeys: 3.55, stopPress: 3.8, done: 3.95, browserOut: 4.3, spec: 4.5, specOut: 5.65, jump: 5.8, title: 6.35,
  },
  build() {
    return `
      <div class="hero-title" id="title" style="top:150px">Not the HTML. <em class="g">The line that makes it.</em></div>
      ${browserHTML({ x: 160, y: 110, w: 1280, h: 690 })}
      ${bubbleHTML("b1")}
      ${POINTER}
      ${specHTML("spec", "Copied: the spec your agent reads", [
        `<span class="q">&gt; This ${mk} should link to the customer page.</span>`,
        `- ${mk} «Marco Peña» → code:`,
        `  - <span class="k">text at:</span> ${loc("src/components/OrdersTable.tsx:10")}`,
      ], { x: 290, y: 330, w: 1020, fs: 30, lh: 52 })}`;
  },
  async setup() {
    this.jump = Jump($("stage"), {
      id: "jump", stageW: 1600, stageH: 900,
      html: "<td>Marco Peña</td>",
      file: "src/components/OrdersTable.tsx", url: `${SRC}components/OrdersTable.tsx`, from: 8, to: 13, hot: 10, mark: '"Marco Peña"',
      card: { x: 96, y: 512, w: 560 }, pane: { x: 770, y: 356, w: 760 }, htmlSize: 40, codeSize: 26, codeLine: 46,
    });
    await this.jump.load();
  },
  measure() {
    frameApp({ fit: "t-panel", margin: 44, top: 40 });
    L.target = rectOf($("t-marco"));
    placeFlash("flash1", L.target);
    buildWords("b1", "This should link to the customer page.");
    placeBubble("b1", L.target, "above");
    placeStopKeys();
    this.jump.measure();
  },
  render(t) {
    const T = this.T;
    const fOut = prog(t, T.fOut, T.fOut + 0.45);
    // The jump: finished (and the loop's first frame) until fOut, drawn from its start at T.jump.
    if (t < T.jump) this.jump.render(99, fOut);
    else this.jump.render(t - T.jump);
    const titleIn = out(prog(t, T.title, T.title + 0.5));
    const title = t < T.jump ? 1 - inOut(fOut) : titleIn;
    style($("title"), title, `translateY(${(t < T.jump ? -16 * inOut(fOut) : 16 * (1 - titleIn)).toFixed(2)}px)`);

    const bin = outQuint(prog(t, T.browserIn, T.browserIn + 0.7));
    const bout = inOut(prog(t, T.browserOut, T.browserOut + 0.4));
    style($("browser"), Math.min(bin, 1 - bout), `translateY(${40 * (1 - bin) + 30 * bout}px) scale(${(0.96 + 0.04 * bin) * (1 - 0.08 * bout)})`);
    drawPill(t, "pill-rec", T.browserIn + 0.45, T.done - 0.1);
    drawPill(t, "pill-done", T.done, 99);
    drawPill(t, "pill-notes", 99, 99);

    const show = Math.min(out(prog(t, T.cursorIn, T.cursorIn + 0.25)), 1 - inOut(prog(t, T.click + 0.8, T.click + 1.1)));
    drawPointer(t, { start: { x: 1250, y: 820 }, moves: [[T.move[0], T.move[1], aim(L.target, 0.5)]], clicks: [{ t: T.click, alt: true, flash: "flash1" }], show });
    drawBubble(t, "b1", T.bubble, T.words, T.wordStep, T.browserOut - 0.15);
    drawStop(t, T.stopKeys, T.stopPress, T.done + 0.1);

    const sin = out(prog(t, T.spec, T.spec + 0.4));
    const sout = inOut(prog(t, T.specOut, T.specOut + 0.35));
    style($("spec"), Math.min(sin, 1 - sout), `translateY(${(20 * (1 - sin) - 40 * sout).toFixed(2)}px)`);
    drawSpecLines(t, "spec", T.spec + 0.15, 0.14);
    document.querySelector("#spec .loc").style.setProperty("--hl", out(prog(t, T.spec + 0.75, T.spec + 1.0)).toFixed(3));
  },
};

/** Typed mode (4.9 s): Alt+click «Status», the note box, a note typed, Enter; Stop, its request. */
CLIPS.typed = {
  size: [1280, 800],
  duration: 4.9,
  keys: { "typed-1-typing": 1.9, "typed-2-spec": 3.9 },
  T: { cursorIn: 0.15, move: [0.2, 0.75], click: 0.85, typing: [1.05, 2.15], enter: 2.35, stopKeys: 2.45, stopPress: 2.65, done: 2.8, spec: 2.95, back: 4.45 },
  note: "Show each status as a colored badge.",
  build() {
    return `
      ${header("Typed mode", "Rather type? <em class=\"g\">Alt+click, write a note</em>")}
      ${browserHTML({ x: 40, y: 150, w: 1200, h: 620 })}
      <div class="note" id="note">
        <div class="box" role="dialog" aria-label="Pointcast note">
          <div class="title"><span class="dot"></span>Pointcast note</div>
          <div class="textarea"><span class="ph" id="note-ph">What should change here?</span><span id="note-text"></span><span class="caret" id="note-caret"></span></div>
          <div class="hint"><kbd>Enter</kbd> save · <kbd>Shift+Enter</kbd> new line · <kbd>Esc</kbd> cancel</div>
        </div>
      </div>
      <div id="enterkey"><span class="key">Enter</span></div>
      ${POINTER}
      ${specHTML("spec", "Copied: the note is its own request", [
        `<span class="q">&gt; ${this.note} ${mk}</span>`,
        `- ${mk} «Status» → code:`,
        `  - <span class="k">text at:</span> ${loc("src/components/OrdersTable.tsx:31")}`,
      ], { x: 150, y: 330, w: 980, fs: 26, lh: 44 })}`;
  },
  measure() {
    frameApp({ fit: "t-panel", margin: 40, top: 30 });
    L.target = rectOf($("t-status"));
    placeFlash("flash1", L.target);
    placeStopKeys();
    // The note box as note-box.ts places it: below the element, kept inside the viewport (2x).
    const vp = rectOf(document.querySelector("#browser .viewport"));
    const note = $("note");
    const left = Math.min(Math.max(vp.x + 16, L.target.x), vp.x + vp.w - 16 - 600);
    const top = L.target.y + L.target.h + 16;
    Object.assign(note.style, { left: `${left}px`, top: `${top}px` });
    const enter = $("enterkey");
    Object.assign(enter.style, { left: `${left + 600 - enter.offsetWidth - 8}px`, top: `${top + note.offsetHeight + 14}px` });
  },
  render(t) {
    const T = this.T;
    const home = 1 - inOut(prog(t, T.back, this.duration));
    drawPill(t, "pill-rec", 99, 99);
    drawPill(t, "pill-notes", 0, T.done - 0.1);
    style($("pill-done"), Math.min(out(prog(t, T.done, T.done + 0.25)), home), `scale(${0.9 + 0.1 * back(prog(t, T.done, T.done + 0.35))})`);
    // Back to the first frame: the Notes pill returns as the done pill goes.
    if (t > T.back) style($("pill-notes"), 1 - home);
    const show = Math.min(out(prog(t, T.cursorIn, T.cursorIn + 0.2)), 1 - inOut(prog(t, T.click + 0.3, T.click + 0.55)));
    drawPointer(t, { start: { x: 1100, y: 740 }, moves: [[T.move[0], T.move[1], aim(L.target)]], clicks: [{ t: T.click, alt: true, flash: "flash1" }], show });

    const boxIn = out(prog(t, T.click + 0.02, T.click + 0.14));
    style($("note"), t < T.enter + 0.04 ? boxIn : 0, `translateY(${(-8 * (1 - boxIn)).toFixed(2)}px)`);
    const chars = Math.round(this.note.length * prog(t, ...T.typing));
    $("note-text").textContent = this.note.slice(0, chars);
    $("note-ph").style.visibility = chars === 0 ? "visible" : "hidden";
    const typing = t >= T.typing[0] && t <= T.typing[1] + 0.1;
    $("note-caret").style.opacity = typing || (t - T.click) % 1 < 0.5 ? "1" : "0";
    style($("enterkey"), span(t, T.enter - 0.35, T.enter + 0.2, 0.15, 0.2), `translateY(${6 * (1 - out(prog(t, T.enter - 0.35, T.enter - 0.2)))}px)`);
    $("enterkey").firstElementChild.classList.toggle("down", Math.abs(t - T.enter) < 0.1);
    drawStop(t, T.stopKeys, T.stopPress, T.done);

    const sin = out(prog(t, T.spec, T.spec + 0.35));
    style($("spec"), Math.min(sin, home), `translateY(${(20 * (1 - sin)).toFixed(2)}px)`);
    drawSpecLines(t, "spec", T.spec + 0.1, 0.12);
    document.querySelector("#spec .loc").style.setProperty("--hl", out(prog(t, T.spec + 0.55, T.spec + 0.8)).toFixed(3));
  },
};

/** Batching (5.1 s): three Alt+clicks, a sentence each, one Stop: one spec with three requests. */
CLIPS.batch = {
  size: [1280, 800],
  duration: 5.2,
  keys: { "batch-1-points": 2.1, "batch-2-spec": 4.2 },
  T: { cursorIn: 0.1, clicks: [0.55, 1.5, 2.45], stopKeys: 2.95, stopPress: 3.15, done: 3.3, spec: 3.4, back: 4.8 },
  said: ["This should say five.", "This should open the report.", "Rename this to Overview."],
  build() {
    const req = (n, quote, el, kind, where) => [
      `<span class="h">## Request ${n}</span>`,
      `<span class="q">&gt; ${quote}</span>`,
      `- ${mk} «${el}» → code:`,
      `  - <span class="k">${kind} at:</span> ${loc(where)}`,
    ];
    return `
      ${header("One recording", "Several changes, <em class=\"g\">one spec</em>")}
      ${browserHTML({ x: 40, y: 150, w: 1200, h: 620 })}
      ${bubbleHTML("b1")}${bubbleHTML("b2")}${bubbleHTML("b3")}
      ${POINTER}
      ${specHTML("spec", "Copied: one spec, three requests", [
        ...req(1, `This ${mk} should say five.`, "3", "data", "src/data/nav.ts:16"),
        null,
        ...req(2, `This ${mk} should open the report.`, "View report", "text", "src/pages/Dashboard.tsx:11"),
        null,
        ...req(3, `Rename this ${mk} to Overview.`, "Dashboard", "text", "src/pages/Dashboard.tsx:9"),
      ], { x: 230, y: 128, w: 820, fs: 23, lh: 36 })}`;
  },
  measure() {
    frameApp({ zoom: 1.3, ox: 0, oy: 0 });
    L.targets = ["t-badge", "t-report", "t-title"].map((id) => rectOf($(id)));
    L.targets.forEach((r, i) => {
      placeFlash(`flash${i + 1}`, r);
      buildWords(`b${i + 1}`, this.said[i]);
      placeBubble(`b${i + 1}`, r, "right");
    });
    placeStopKeys();
  },
  render(t) {
    const T = this.T;
    const home = 1 - inOut(prog(t, T.back, this.duration));
    drawPill(t, "pill-rec", 0, T.done - 0.1);
    drawPill(t, "pill-notes", 99, 99);
    style($("pill-done"), Math.min(out(prog(t, T.done, T.done + 0.25)), home), `scale(${0.9 + 0.1 * back(prog(t, T.done, T.done + 0.35))})`);
    if (t > T.back) style($("pill-rec"), 1 - home);
    const show = Math.min(out(prog(t, T.cursorIn, T.cursorIn + 0.2)), 1 - inOut(prog(t, T.clicks[2] + 0.3, T.clicks[2] + 0.55)));
    const moves = T.clicks.map((c, i) => [c - 0.45, c - 0.08, aim(L.targets[i], i === 0 ? 0.5 : 0.55)]);
    drawPointer(t, { start: { x: 900, y: 700 }, moves, clicks: T.clicks.map((c, i) => ({ t: c, alt: true, flash: `flash${i + 1}` })), show });
    T.clicks.forEach((c, i) => {
      const end = i < 2 ? T.clicks[i + 1] - 0.3 : T.stopKeys;
      drawBubble(t, `b${i + 1}`, c - 0.3, c - 0.2, 0.06, end);
    });
    drawStop(t, T.stopKeys, T.stopPress, T.done);
    const sin = out(prog(t, T.spec, T.spec + 0.35));
    style($("spec"), Math.min(sin, home), `translateY(${(20 * (1 - sin)).toFixed(2)}px)`);
    drawSpecLines(t, "spec", T.spec + 0.05, 0.05);
    document.querySelectorAll("#spec .loc").forEach((l, i) => l.style.setProperty("--hl", out(prog(t, T.spec + 0.7 + i * 0.12, T.spec + 0.95 + i * 0.12)).toFixed(3)));
  },
};

/** Straight to the agent (5.2 s): Alt+click, Stop; the spec goes to the MCP server; the agent reads it and edits the line. */
CLIPS.mcp = {
  size: [1280, 800],
  duration: 5.2,
  keys: { "mcp-1-sent": 2.0, "mcp-2-edit": 4.3 },
  T: { cursorIn: 0.1, move: [0.15, 0.6], click: 0.72, stopKeys: 1.2, stopPress: 1.4, done: 1.55, packet: [1.6, 2.15], cmd: [2.1, 2.4], lines: [2.6, 2.8, 2.9, 3.25, 3.45, 3.6], back: 4.8 },
  build() {
    return `
      ${header("MCP server", "Straight to your agent. <em class=\"g\">No downloads.</em>")}
      ${browserHTML({ x: 40, y: 136, w: 1200, h: 320 })}
      ${bubbleHTML("b1")}
      ${POINTER}
      <div class="term" id="term" style="left:40px; top:480px; width:1200px; height:296px">
        <div class="term-bar"><i></i><i></i><i></i><span>your agent · ~/acme-store</span></div>
        <div class="term-body">
          <div class="tl" id="tl0" style="opacity:1"><span class="pr">&gt;</span> <span id="cmd"></span><span class="caret" id="tcaret"></span></div>
          <div class="tl" id="tl1"><span class="dotg">●</span> <b>pointcast</b> · get_session(<span class="s">"latest"</span>)</div>
          <div class="tl dim" id="tl2">  ⎿ &gt; This [a] should say five.</div>
          <div class="tl dim" id="tl3">      - data at: \`src/data/nav.ts:16\`</div>
          <div class="tl" id="tl4"><span class="dotg">●</span> Update <b>src/data/nav.ts:16</b></div>
          <div class="tl del" id="tl5">  16 -  { id: "messages", label: "Messages", href: "/messages", badge: <b>3</b> },</div>
          <div class="tl add" id="tl6">  16 +  { id: "messages", label: "Messages", href: "/messages", badge: <b>5</b> },</div>
        </div>
      </div>
      <div class="packet" id="packet"><img src="${ICON}" alt="">to the MCP server</div>`;
  },
  measure() {
    frameApp({ zoom: 1.2, ox: 0, oy: 0 });
    L.target = rectOf($("t-badge"));
    placeFlash("flash1", L.target);
    buildWords("b1", "This should say five.");
    placeBubble("b1", L.target, "right");
    placeStopKeys();
    L.pill = rectOf($("pill-done"));
    L.term = rectOf($("term"));
    L.packetW = $("packet").offsetWidth;
  },
  render(t) {
    const T = this.T;
    const home = 1 - inOut(prog(t, T.back, this.duration));
    drawPill(t, "pill-rec", 0, T.done - 0.1);
    drawPill(t, "pill-notes", 99, 99);
    style($("pill-done"), Math.min(out(prog(t, T.done, T.done + 0.25)), home), `scale(${0.9 + 0.1 * back(prog(t, T.done, T.done + 0.35))})`);
    if (t > T.back) style($("pill-rec"), 1 - home);
    const show = Math.min(out(prog(t, T.cursorIn, T.cursorIn + 0.2)), 1 - inOut(prog(t, T.click + 0.35, T.click + 0.6)));
    drawPointer(t, { start: { x: 700, y: 420 }, moves: [[T.move[0], T.move[1], aim(L.target, 0.5)]], clicks: [{ t: T.click, alt: true, flash: "flash1" }], show });
    drawBubble(t, "b1", T.click - 0.4, T.click - 0.3, 0.12, T.stopKeys + 0.1);
    drawStop(t, T.stopKeys, T.stopPress, T.done);

    // The recording leaves the browser for the MCP server the agent runs: no file, no download.
    const p = inOut(prog(t, ...T.packet));
    const from = { x: L.pill.x + L.pill.w / 2 - L.packetW / 2, y: L.pill.y + L.pill.h - 6 };
    const to = { x: L.term.x + 150, y: L.term.y + 50 };
    style($("packet"), p > 0 && p < 1 ? Math.min(1, p * 6, (1 - p) * 4) : 0, `translate(${mix(from.x, to.x, p).toFixed(1)}px, ${(mix(from.y, to.y, p) - 40 * Math.sin(Math.PI * p)).toFixed(1)}px)`);

    const cmd = "/pointcast";
    $("cmd").textContent = cmd.slice(0, Math.round(cmd.length * prog(t, ...T.cmd)));
    $("tcaret").style.opacity = t > T.lines[0] - 0.05 ? "0" : (t < T.cmd[0] || t > T.cmd[1]) && t % 1 >= 0.5 ? "0" : "1";
    T.lines.forEach((a, i) => {
      const q = out(prog(t, a, a + 0.2));
      style($(`tl${i + 1}`), Math.min(q, home), `translateY(${(6 * (1 - q)).toFixed(2)}px)`);
    });
    if (t > T.back) $("cmd").style.opacity = home.toFixed(3);
    else $("cmd").style.opacity = "1";
  },
};

/** Debug capture (5 s): a click on Export does nothing; Alt+click it, "This does nothing."; Stop: the spec has the failed request. */
CLIPS.errors = {
  size: [1280, 800],
  duration: 5.0,
  keys: { "errors-1-point": 1.5, "errors-2-spec": 4.0 },
  T: { cursorIn: 0.1, move: [0.15, 0.6], plain: 0.75, click: 1.35, stopKeys: 1.95, stopPress: 2.15, done: 2.3, spec: 2.4, back: 4.6 },
  build() {
    return `
      ${header("Debug capture", "Broken? The spec <em class=\"g\">brings the error</em>")}
      ${browserHTML({ x: 40, y: 150, w: 1200, h: 620 })}
      ${bubbleHTML("b1")}
      ${POINTER}
      ${specHTML("spec", "Copied: the spec your agent reads", [
        `<span class="q">&gt; This ${mk} does nothing.</span>`,
        `- ${mk} «Export» → code:`,
        `  - <span class="k">text at:</span> ${loc("src/components/OrdersTable.tsx:22")}`,
        `  - errors around this moment:`,
        `    - <span class="errln"><span class="err">network:</span> POST /api/export → <span class="err">500</span> (0.6 s before)</span>`,
      ], { x: 110, y: 300, w: 1060, fs: 25, lh: 44 })}`;
  },
  measure() {
    frameApp({ fit: "t-panel", margin: 40, top: 30 });
    L.target = rectOf($("t-export"));
    placeFlash("flash1", L.target);
    buildWords("b1", "This does nothing.");
    placeBubble("b1", L.target, "above");
    // Above Export, the bubble would leave the stage on the right: keep it inside.
    const b = $("b1");
    const over = parseFloat(b.style.left) + b.offsetWidth - 1240;
    if (over > 0) {
      b.style.left = `${parseFloat(b.style.left) - over}px`;
      b.querySelector(".tail").style.left = `${L.target.cx - parseFloat(b.style.left) - 11}px`;
      b.style.transformOrigin = `${L.target.cx - parseFloat(b.style.left)}px 100%`;
    }
    placeStopKeys();
  },
  render(t) {
    const T = this.T;
    const home = 1 - inOut(prog(t, T.back, this.duration));
    drawPill(t, "pill-rec", 0, T.done - 0.1);
    drawPill(t, "pill-notes", 99, 99);
    style($("pill-done"), Math.min(out(prog(t, T.done, T.done + 0.25)), home), `scale(${0.9 + 0.1 * back(prog(t, T.done, T.done + 0.35))})`);
    if (t > T.back) style($("pill-rec"), 1 - home);
    const show = Math.min(out(prog(t, T.cursorIn, T.cursorIn + 0.2)), 1 - inOut(prog(t, T.click + 0.35, T.click + 0.6)));
    drawPointer(t, {
      start: { x: 900, y: 720 },
      moves: [[T.move[0], T.move[1], aim(L.target)]],
      clicks: [{ t: T.plain, alt: false }, { t: T.click, alt: true, flash: "flash1" }],
      show,
    });
    drawBubble(t, "b1", T.click - 0.3, T.click - 0.2, 0.14, T.stopKeys + 0.1);
    drawStop(t, T.stopKeys, T.stopPress, T.done);
    const sin = out(prog(t, T.spec, T.spec + 0.35));
    style($("spec"), Math.min(sin, home), `translateY(${(20 * (1 - sin)).toFixed(2)}px)`);
    drawSpecLines(t, "spec", T.spec + 0.1, 0.12);
    document.querySelector("#spec .loc").style.setProperty("--hl", out(prog(t, T.spec + 0.6, T.spec + 0.85)).toFixed(3));
    document.querySelector("#spec .errln").style.setProperty("--hl", out(prog(t, T.spec + 0.95, T.spec + 1.25)).toFixed(3));
  },
};

// ---------------------------------------------------------------- start

const clip = CLIPS[CLIP];
window.CLIPS = Object.fromEntries(Object.entries(CLIPS).map(([name, c]) => [name, { size: c.size, duration: c.duration, keys: c.keys }]));
window.ready = (async () => {
  if (!clip) throw new Error(`no clip named ${CLIP}`);
  const stage = $("stage");
  const [w, h] = clip.size;
  if (w !== 1600) stage.classList.add("mini");
  stage.innerHTML = clip.build();
  buildChart();
  if (clip.setup) await clip.setup();
  await Promise.all([
    document.fonts.ready,
    ...["400 16px Inter", "500 16px Inter", "600 16px Inter", "700 16px Inter", "800 16px Inter", "400 16px 'JetBrains Mono'", "500 16px 'JetBrains Mono'", "600 16px 'JetBrains Mono'", "700 16px 'JetBrains Mono'"].map((f) => document.fonts.load(f).catch(() => {})),
    ...[...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))),
  ]);
  clip.measure();
  const renderAt = (tRaw) => clip.render(((tRaw % clip.duration) + clip.duration) % clip.duration);
  window.renderAt = renderAt;
  renderAt(0);

  if (!/[?&]capture\b/.test(location.search)) {
    const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / w, innerHeight / h)})`; };
    fit();
    addEventListener("resize", fit);
    const hold = /#t=([\d.]+)/.exec(location.hash);
    if (hold) renderAt(Number(hold[1]));
    else {
      const t0 = performance.now();
      const tick = (now) => { renderAt((now - t0) / 1000); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
  }
  return clip.duration;
})();
