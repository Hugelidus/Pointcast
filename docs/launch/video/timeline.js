// The Pointcast demo as a pure function of time: renderAt(t) sets every element's style for the
// instant t (seconds), from nothing but t and the layout measured once at load. No CSS transitions,
// no timers: render.mjs steps t by 1/30 s in headless Chromium and screenshots each frame, and the
// same t always gives the same frame. The last frame flows into the first (the end card turns back
// into the title), so the MP4 and the GIF loop without a seam.
"use strict";

/** Length of one loop, in seconds. renderAt(DURATION) looks exactly like renderAt(0). */
const DURATION = 27.55;

// ---------------------------------------------------------------- timeline (seconds)

const SPEC = 8.8; // scene 5: the phrases leave the page for the spec
const CODE = SPEC + 3.2; // scene 6: the editor
const JUMP = CODE + 3.2; // the jump: not the element's HTML, the line of source that makes it
const TYPED = JUMP + 3.6; // scene 7: the same gesture with a typed note instead of words
const END = TYPED + 6.45; // the end card
const T = {
  titleOut: 1.0, // the title holds until here, then clears in 0.5 s
  browserIn: 1.1,
  cursorIn: 1.8,
  move1: [1.9, 2.55],
  click1: 2.68, // just after "This": the [a] of Request 1
  bubble1: 2.3,
  words1: [2.45, 2.82, 3.0, 3.15, 3.27, 3.38, 3.5, 3.72],
  scroll: [4.0, 4.65], // the page scrolls so the Orders table and its Export button are in view
  move2: [4.45, 5.15],
  click2: 5.28, // just after "this": the [a] of Request 2
  bubble2: 4.8,
  words2: [4.95, 5.12, 5.38, 5.58, 5.76, 5.95, 6.08, 6.2, 6.45],
  cursorOut: 6.7,
  stopKeys: 6.8,
  stopPress: 7.05,
  processing: 7.15,
  done: 8.05,
  spec: SPEC,
  lines: { L0: SPEC + 0.95, L1: SPEC + 1.1, L5: SPEC + 1.1, markers: SPEC + 1.35, L3: SPEC + 1.6, L7: SPEC + 1.75, L4: SPEC + 2.0, L8: SPEC + 2.15 },
  code: CODE,
  jump: JUMP,
  arrow1: [CODE + 0.95, CODE + 1.45],
  arrow2: [CODE + 1.8, CODE + 2.3],
  typed: TYPED,
  // Scene 7: the browser comes back (still scrolled to the Orders table), the pill reads "Notes".
  browser2: TYPED + 0.15,
  move3: [TYPED + 0.55, TYPED + 1.1],
  click3: TYPED + 1.2, // on «Status»: the note box opens by it, with the focus
  typing: [TYPED + 1.4, TYPED + 2.75],
  enter: TYPED + 3.1, // saves the note and closes the box
  stopKeys2: TYPED + 3.15,
  stopPress2: TYPED + 3.35,
  done2: TYPED + 3.7, // no words to transcribe: the spec is ready at once
  spec2: TYPED + 4.05,
  arrow3: [TYPED + 4.9, TYPED + 5.35],
  endOut: END - 0.3,
  end: END,
  loop: DURATION - 0.6, // the end card starts turning back into the title
};

const WORDS1 = ["This", "should", "take", "you", "to", "the", "reports", "page."];
const WORDS2 = ["And", "this", "button", "should", "export", "only", "the", "filtered", "orders."];
/** Scene 7's note, typed a character at a time. */
const NOTE = "Show each status as a colored badge.";
/** How far the page scrolls (CSS px of the app, shown at 1.3x). */
const SCROLL = 150;
const ZOOM = 1.3;

// ---------------------------------------------------------------- easing

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const mix = (a, b, p) => a + (b - a) * p;
const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const out = (x) => 1 - Math.pow(1 - x, 3);
const outQuint = (x) => 1 - Math.pow(1 - x, 5);
const back = (x) => { const c1 = 1.3, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
/** Fades in over [a, a+din] and out over [b, b+dout]. */
const span = (t, a, b, din = 0.4, dout = 0.4) => Math.min(out(prog(t, a, a + din)), 1 - inOut(prog(t, b, b + dout)));

const $ = (id) => document.getElementById(id);
function style(el, opacity, transform) {
  el.style.opacity = opacity.toFixed(4);
  el.style.visibility = opacity <= 0.001 ? "hidden" : "visible";
  if (transform !== undefined) el.style.transform = transform;
}

// ---------------------------------------------------------------- building the page

const WEEKLY_SALES = [32, 48, 40, 65, 54, 72, 61]; // dev/examples/react-dashboard/src/components/SalesChart.tsx

function buildChart() {
  const max = Math.max(...WEEKLY_SALES);
  $("chart").innerHTML = WEEKLY_SALES.map((v, i) => {
    const h = (v / max) * 120;
    return `<rect class="chart-bar" x="${i * 54}" y="${120 - h}" width="40" height="${h}"/>`;
  }).join("");
}

function buildWords(id, words) {
  $(id).innerHTML = words.map((w, i) => `<span>${w}</span>${i < words.length - 1 ? " " : ""}`).join("");
}

/** The real lines of the example (shared.js). */
async function buildCode(id, url, from, to, hot) {
  $(id).innerHTML = await window.PC.codeRows(url, from, to, hot);
}

/**
 * The jump (shared.js): «View report» as the browser has it, struck out, and the line that makes
 * it, Dashboard.tsx:11, where this instance passes its reportHref (the spec's `text at:`).
 */
let jump;

// ---------------------------------------------------------------- layout, measured once

const L = {};

function rectOf(el) {
  const s = $("stage").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, cx: r.left - s.left + r.width / 2, cy: r.top - s.top + r.height / 2 };
}

/** Where the spec sits in scene 6, relative to its scene-5 place (transform-origin 0 0). */
const DOC5 = { x: 370, y: 186 };
const DOC6 = { x: 50, y: 196, s: 0.74 };
const toDoc6 = (p) => ({ x: DOC6.x + (p.x - DOC5.x) * DOC6.s, y: DOC6.y + (p.y - DOC5.y) * DOC6.s });
/** Scene 7's spec is at scene 6's place from the start (#doc3 sits at DOC6, scaled from there). */
const toDoc3 = (p) => ({ x: DOC6.x + (p.x - DOC6.x) * DOC6.s, y: DOC6.y + (p.y - DOC6.y) * DOC6.s });
/** The note box's WIDTH_PX and GAP_PX (note-box.ts), at the 2x it is drawn at. */
const NOTE_W = 600, NOTE_GAP = 16;

function measure() {
  // Everything at rest: no transform, markers at full width (the final line layout).
  for (const el of $("stage").children) el.style.transform = "none";
  for (const id of ["mk1", "mk2"]) $(id).style.width = "auto";

  const app = document.querySelector(".app");
  app.style.transform = `scale(${ZOOM})`;
  L.report = rectOf($("t-report"));
  app.style.transform = `translateY(${-SCROLL * ZOOM}px) scale(${ZOOM})`;
  L.export = rectOf($("t-export")); // where it is once the page has scrolled
  L.status = rectOf($("t-status"));
  app.style.transform = `scale(${ZOOM})`;
  for (const [id, r] of [["flash1", L.report], ["flash2", L.export], ["flash3", L.status]]) {
    Object.assign($(id).style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  // The note box where note-box.ts place() puts it: below the element when it fits, its left edge
  // on the element's but kept inside the viewport.
  const vp = rectOf(document.querySelector("#browser .viewport"));
  const note = $("note");
  const noteH = note.offsetHeight;
  const below = L.status.y + L.status.h + NOTE_GAP;
  const noteTop = below + noteH <= vp.y + vp.h - NOTE_GAP ? below : L.status.y - NOTE_GAP - noteH;
  const noteLeft = Math.min(Math.max(vp.x + NOTE_GAP, L.status.x), vp.x + vp.w - NOTE_GAP - NOTE_W);
  L.note = { x: noteLeft, y: noteTop, w: NOTE_W, h: noteH };
  Object.assign(note.style, { left: `${noteLeft}px`, top: `${noteTop}px` });
  const enter = $("enterkey");
  Object.assign(enter.style, { left: `${noteLeft + NOTE_W - enter.offsetWidth - 8}px`, top: `${noteTop + noteH + 14}px` });

  // Bubble 1 to the right of «View report» (over the Orders card, never over Revenue); bubble 2
  // above «Export», over the sales chart, its tail pointing down at the button.
  const b1 = $("b1"), b2 = $("b2");
  const b1h = b1.offsetHeight;
  b1.style.left = `${L.report.x + L.report.w + 34}px`;
  b1.style.top = `${L.report.cy - b1h / 2 - 8}px`;
  Object.assign(b1.querySelector(".tail").style, { left: "-10px", top: `${b1h / 2 - 3}px` });
  b1.style.transformOrigin = "0 50%";
  const b2w = b2.offsetWidth, b2h = b2.offsetHeight;
  b2.style.left = `${L.export.x + L.export.w + 24 - b2w}px`;
  b2.style.top = `${L.export.y - 30 - b2h}px`;
  Object.assign(b2.querySelector(".tail").style, { right: "44px", bottom: "-10px" });
  b2.style.transformOrigin = `${b2w - 50}px 100%`;

  // Bubble 1 scrolls with the page, so its phrase leaves from where it is after the scroll.
  L.said1 = rectOf($("said1"));
  L.said1.y -= SCROLL * ZOOM;
  L.said1.cy -= SCROLL * ZOOM;
  L.said2 = rectOf($("said2"));
  L.words1 = rectOf($("L2").querySelector(".words"));
  L.words2 = rectOf($("L6").querySelector(".words"));
  L.mk = $("mk1").getBoundingClientRect().width;
  L.loc1 = rectOf($("loc1"));
  L.loc2 = rectOf($("loc2"));
  L.row11 = rectOf($("code1").querySelector(".row.hot"));
  L.row22 = rectOf($("code2").querySelector(".row.hot"));
  L.loc3 = rectOf($("loc3"));
  L.row31 = rectOf($("code3").querySelector(".row.hot"));

  // The flying phrases start as the bubbles' text.
  for (const [fly, said, rect] of [["fly1", "said1", L.said1], ["fly2", "said2", L.said2]]) {
    $(fly).textContent = $(said).textContent;
    Object.assign($(fly).style, { left: `${rect.x}px`, top: `${rect.y}px` });
  }
  // The flight lands the phrase on the words of the quote line (before the [a] marker opens).
  L.flyW1 = $("fly1").getBoundingClientRect().width;
  L.flyW2 = $("fly2").getBoundingClientRect().width;
  L.words1W = L.words1.w - L.mk;
  L.words2W = L.words2.w - L.mk;

  // Arrows: from each location in the spec (at its scene-6 place) to its line in the editor.
  for (const [g, loc, row, toPlace] of [["arrow1", L.loc1, L.row11, toDoc6], ["arrow2", L.loc2, L.row22, toDoc6], ["arrow3", L.loc3, L.row31, toDoc3]]) {
    const a = toPlace({ x: loc.x + loc.w, y: loc.cy });
    const x0 = a.x + 14, y0 = a.y;
    const x1 = row.x - 8, y1 = row.cy;
    const dx = Math.max(60, (x1 - x0) * 0.55);
    const path = $(g).querySelector(".shaft");
    path.setAttribute("d", `M${x0} ${y0} C${x0 + dx} ${y0} ${x1 - dx} ${y1} ${x1 - 12} ${y1}`);
    $(g).querySelector(".head").setAttribute("d", `M${x1 - 16} ${y1 - 10} L${x1 + 2} ${y1} L${x1 - 16} ${y1 + 10} Z`);
    L[g] = { path, len: path.getTotalLength() };
  }
}

// ---------------------------------------------------------------- the frame

function cursorAt(t) {
  const start = { x: 1180, y: 790 };
  const p1 = { x: L.report.x + L.report.w * 0.55, y: L.report.cy + 2 };
  const p2 = { x: L.export.x + L.export.w * 0.6, y: L.export.cy + 3 };
  const arc = (a, b, p, bend) => {
    const e = inOut(p);
    const c = { x: (a.x + b.x) / 2 + bend, y: (a.y + b.y) / 2 - Math.abs(bend) * 0.6 };
    const u = 1 - e;
    return { x: u * u * a.x + 2 * u * e * c.x + e * e * b.x, y: u * u * a.y + 2 * u * e * c.y + e * e * b.y };
  };
  if (t >= T.typed) return arc(start, { x: L.status.x + L.status.w * 0.5, y: L.status.cy + 3 }, prog(t, ...T.move3), 60);
  if (t < T.move2[0]) return arc(start, p1, prog(t, ...T.move1), 60);
  // The cursor stays put while the page scrolls under it, then goes to Export.
  return arc(p1, p2, prog(t, ...T.move2), 70);
}

function renderAt(tRaw) {
  const t = ((tRaw % DURATION) + DURATION) % DURATION;

  // ---- title and end card (shared lockup: the loop seam)
  const titleOut = inOut(prog(t, T.titleOut, T.titleOut + 0.5));
  const endIn = out(prog(t, T.end, T.end + 0.6));
  const toTitle = inOut(prog(t, T.loop, DURATION));
  let lockupY, lockupOp, lockupScale;
  if (t < T.end) {
    lockupY = 300 - 24 * titleOut;
    lockupOp = 1 - titleOut;
    lockupScale = 1 - 0.04 * titleOut;
  } else {
    lockupY = mix(252, 300, toTitle) + 20 * (1 - endIn);
    lockupOp = endIn;
    lockupScale = 0.94 + 0.06 * endIn;
  }
  style($("lockup"), lockupOp, `translateY(${lockupY}px) scale(${lockupScale})`);
  // Back to the title: the end lines clear first, then "Talk and point." comes in (no overlap).
  const tag1In = out(prog(t, T.loop + 0.25, DURATION));
  const tag1 = t < T.end ? 1 - titleOut : tag1In;
  const tag1Y = t < T.end ? -24 * titleOut : 14 * (1 - tag1In);
  style($("tag1"), tag1, `translateY(${tag1Y}px)`);
  const endLine = (start) => {
    const a = out(prog(t, start, start + 0.5));
    const b = inOut(prog(t, T.loop, T.loop + 0.3));
    return { op: Math.min(a, 1 - b), y: 16 * (1 - a) - 12 * b };
  };
  for (const [id, start] of [["tag2", T.end + 0.25], ["agents", T.end + 0.5], ["url", T.end + 0.7]]) {
    const e = endLine(start);
    style($(id), e.op, `translateY(${e.y}px)`);
  }

  // ---- headers and the corner brand
  const heads = [["h1", T.browserIn + 0.1, T.stopKeys - 0.1], ["h2", T.stopKeys - 0.1, T.spec], ["h3", T.spec, T.code], ["h4", T.code, T.jump], ["hj", T.jump, T.typed], ["h5", T.typed, T.endOut]];
  for (const [id, a, b] of heads) {
    const op = span(t, a, b - 0.15, 0.45, 0.3);
    const y = 14 * (1 - out(prog(t, a, a + 0.45)));
    style($(id), op, `translateY(${y}px)`);
  }
  style($("brand"), span(t, T.browserIn + 0.1, T.endOut, 0.5, 0.4));

  // ---- browser
  const bin = outQuint(prog(t, T.browserIn, T.browserIn + 0.75));
  const bout = inOut(prog(t, T.spec, T.spec + 0.5));
  // Scene 7 brings it back the same way, and sends it off the same way for its spec.
  const bin2 = outQuint(prog(t, T.browser2, T.browser2 + 0.75));
  const bout2 = inOut(prog(t, T.spec2, T.spec2 + 0.35));
  const [bi, bo] = t < T.typed ? [bin, bout] : [bin2, bout2];
  style($("browser"), Math.min(bi, 1 - bo), `translateY(${40 * (1 - bi) + 40 * bo}px) scale(${(0.96 + 0.04 * bi) * (1 - 0.1 * bo)})`);

  // pill states
  const rec = span(t, T.browserIn + 0.5, T.processing - 0.12, 0.3, 0.12);
  style($("pill-rec"), rec, `scale(${0.9 + 0.1 * back(prog(t, T.browserIn + 0.5, T.browserIn + 0.8))})`);
  const proc = span(t, T.processing, T.done - 0.12, 0.2, 0.12);
  style($("pill-proc"), proc, `scale(${0.9 + 0.1 * back(prog(t, T.processing, T.processing + 0.3))})`);
  const pp = prog(t, T.processing, T.done - 0.1);
  $("proc-fill").style.width = `${(6 + 88 * out(pp)).toFixed(2)}%`;
  $("proc-text").textContent = `Processing… ~0:0${Math.max(1, 3 - Math.floor(pp * 3))}`;
  $("pill-proc").querySelector(".dot").style.transform = `scale(${0.8 + 0.2 * Math.sin(2 * Math.PI * (t - T.processing) * 1.2)})`;
  // A typed recording's pill reads "Notes" (indicator.ts): no microphone is on.
  const notes = span(t, T.browser2 + 0.5, T.done2 - 0.12, 0.3, 0.12);
  style($("pill-notes"), notes, `scale(${0.9 + 0.1 * back(prog(t, T.browser2 + 0.5, T.browser2 + 0.8))})`);
  const doneAt = t < T.typed ? T.done : T.done2;
  const done = out(prog(t, doneAt, doneAt + 0.25));
  style($("pill-done"), done, `scale(${0.9 + 0.1 * back(prog(t, doneAt, doneAt + 0.35))})`);

  // ---- cursor, Alt key, flash, ripple
  const cur = cursorAt(t);
  const curOp = t < T.typed
    ? Math.min(out(prog(t, T.cursorIn, T.cursorIn + 0.3)), 1 - inOut(prog(t, T.cursorOut, T.cursorOut + 0.3)), 1 - bout)
    : Math.min(out(prog(t, T.move3[0] - 0.25, T.move3[0] + 0.05)), 1 - inOut(prog(t, T.click3 + 0.35, T.click3 + 0.65)));
  const press = (c) => { const d = t - c; return d < -0.08 || d > 0.2 ? 0 : d < 0 ? (d + 0.08) / 0.08 : 1 - d / 0.2; };
  const pressing = Math.max(press(T.click1), press(T.click2), press(T.click3));
  style($("cursor"), curOp, `translate(${cur.x - 2}px, ${cur.y - 2}px) scale(${1 - 0.14 * pressing})`);

  const clicks = [T.click1, T.click2, T.click3];
  const altOp = Math.max(...clicks.map((c) => span(t, c - 0.45, c + 0.45, 0.2, 0.25)));
  style($("altkey"), altOp, `translate(${cur.x + 26}px, ${cur.y + 30}px)`);
  const altDown = clicks.some((c) => Math.abs(t - c) < 0.12);
  $("altkey").firstElementChild.classList.toggle("down", altDown);

  // The capture flash, as the extension draws it: full, then fading over the last 40 %.
  const flash = (c) => { const d = t - c; const dur = 0.75; return d < 0 || d > dur ? 0 : d < dur * 0.6 ? 1 : 1 - (d - dur * 0.6) / (dur * 0.4); };
  style($("flash1"), flash(T.click1));
  style($("flash2"), flash(T.click2));
  style($("flash3"), flash(T.click3));
  const rip = (c) => prog(t, c, c + 0.55);
  const r = t < T.move2[0] ? rip(T.click1) : t < T.typed ? rip(T.click2) : rip(T.click3);
  const ro = r <= 0 || r >= 1 ? 0 : 1 - r;
  style($("ripple"), ro, `translate(${cur.x}px, ${cur.y}px)`);
  $("ripple").style.setProperty("--s", (0.2 + 0.8 * out(r)).toFixed(3));

  // Stop shortcut. A typed recording has no processing pill to stand beside: the keys go before
  // the done pill takes their corner.
  const [skAt, skPress, skOut] = t < T.typed ? [T.stopKeys, T.stopPress, T.processing + 0.35] : [T.stopKeys2, T.stopPress2, T.stopPress2 + 0.05];
  const sk = span(t, skAt, skOut, 0.3, 0.3);
  style($("stopkeys"), sk, `translate(${1400 - 24 - 330 - 310}px, ${172 + 690 - 24 - 72 + 10 * (1 - out(prog(t, skAt, skAt + 0.3)))}px)`);
  const sDown = t >= skPress && t < skPress + 0.16;
  for (const k of $("stopkeys").querySelectorAll(".key")) k.classList.toggle("down", sDown);

  // ---- speech bubbles, typed word by word
  const bubbleFade = 1 - inOut(prog(t, T.spec, T.spec + 0.2));
  const b1in = back(prog(t, T.bubble1, T.bubble1 + 0.35));
  const scrollY = -SCROLL * ZOOM * inOut(prog(t, ...T.scroll));
  document.querySelector(".app").style.transform = `translateY(${scrollY.toFixed(2)}px) scale(${ZOOM})`;
  style($("b1"), Math.min(out(prog(t, T.bubble1, T.bubble1 + 0.25)), bubbleFade), `translateY(${scrollY.toFixed(2)}px) scale(${0.85 + 0.15 * b1in})`);
  const b2in = back(prog(t, T.bubble2, T.bubble2 + 0.35));
  style($("b2"), Math.min(out(prog(t, T.bubble2, T.bubble2 + 0.25)), bubbleFade), `scale(${0.85 + 0.15 * b2in})`);
  const typed = (id, times) => {
    const spans = $(id).children;
    times.forEach((w, i) => { spans[i].style.opacity = out(prog(t, w, w + 0.14)).toFixed(3); });
  };
  typed("said1", T.words1);
  typed("said2", T.words2);
  const talking = (a, b) => (t >= a && t <= b ? Math.min(1, (t - a) / 0.15, (b - t) / 0.15) : 0);
  const waves = [[$("b1"), talking(T.words1[0] - 0.05, T.words1.at(-1) + 0.25)], [$("b2"), talking(T.words2[0] - 0.05, T.words2.at(-1) + 0.25)]];
  for (const [b, k] of waves) {
    [...b.querySelectorAll(".wave i")].forEach((bar, i) => {
      const v = 0.5 + 0.5 * Math.sin(t * (13 + i * 3.1) + i * 1.7);
      bar.style.transform = `scaleY(${(0.22 + k * 0.78 * (0.3 + 0.7 * v)).toFixed(3)})`;
    });
  }

  // ---- scene 5: the phrases fly into the spec
  const docMove = inOut(prog(t, T.code, T.code + 0.7));
  const docIn = out(prog(t, T.spec + 0.35, T.spec + 0.8));
  const docOut = inOut(prog(t, T.jump, T.jump + 0.4));
  const dx = mix(0, DOC6.x - DOC5.x, docMove), dy = mix(18 * (1 - docIn), DOC6.y - DOC5.y, docMove), ds = mix(1, DOC6.s, docMove);
  style($("doc"), Math.min(docIn, 1 - docOut), `translate(${dx}px, ${dy}px) scale(${ds})`);

  const flights = [["fly1", L.said1, L.words1, L.flyW1, L.words1W, T.spec + 0.05, "L2"], ["fly2", L.said2, L.words2, L.flyW2, L.words2W, T.spec + 0.22, "L6"]];
  for (const [id, from, to, wFrom, wTo, t0, line] of flights) {
    const p = prog(t, t0, t0 + 0.85);
    const e = inOut(p);
    const s = mix(1, wTo / wFrom, e);
    const lift = -46 * Math.sin(Math.PI * e);
    const x = mix(from.x, to.x, e), y = mix(from.y, to.y + (to.h - from.h * (wTo / wFrom)) / 2, e) + lift;
    // The phrase travels on its own white card (readable over the fading page); near the spec
    // the card dissolves and the words turn to the spec's colour, then the quote line takes over.
    const fop = p <= 0 ? 0 : 1 - out(prog(p, 0.82, 0.95));
    const k = inOut(prog(e, 0.5, 0.88));
    const el = $(id);
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.setProperty("--card", (1 - k).toFixed(3));
    el.style.color = `rgb(${Math.round(mix(18, 201, k))}, ${Math.round(mix(15, 195, k))}, ${Math.round(mix(45, 245, k))})`;
    style(el, t < t0 + 0.9 ? fop : 0, `translate(${x}px, ${y}px) scale(${s})`);
    // The quote's own words take over as the phrase lands.
    const land = out(prog(p, 0.86, 1));
    $(line).querySelector(".words").style.opacity = land.toFixed(3);
  }
  if (t < T.spec) { $("said1").style.visibility = "visible"; $("said2").style.visibility = "visible"; }
  else { $("said1").style.visibility = "hidden"; $("said2").style.visibility = "hidden"; }

  // The structure builds around the phrases, line by line.
  const lineIn = (id, at) => {
    const p = out(prog(t, at, at + 0.35));
    style($(id), p, `translateX(${-14 * (1 - p)}px)`);
  };
  lineIn("L0", T.lines.L0);
  lineIn("L1", T.lines.L1);
  lineIn("L5", T.lines.L5);
  lineIn("L3", T.lines.L3);
  lineIn("L7", T.lines.L7);
  lineIn("L4", T.lines.L4);
  lineIn("L8", T.lines.L8);
  const mk = inOut(prog(t, T.lines.markers, T.lines.markers + 0.4));
  for (const id of ["mk1", "mk2"]) {
    $(id).style.width = `${(L.mk * mk).toFixed(2)}px`;
    $(id).style.opacity = mk.toFixed(3);
  }
  for (const id of ["L2", "L6"]) $(id).querySelector(".gt").style.opacity = mk.toFixed(3);

  // ---- scene 6: the editor and the arrows
  const edIn = outQuint(prog(t, T.code + 0.2, T.code + 0.95));
  style($("editor"), Math.min(edIn, 1 - docOut), `translateX(${60 * (1 - edIn)}px)`);
  // ---- the jump: after the editor, before typed mode
  jump.render(t < T.jump + 0.2 ? -1 : t - T.jump - 0.2, prog(t, T.typed - 0.4, T.typed + 0.1));

  // ---- scene 7: the note box, then the typed request and its line
  // The box appears as note-box.ts animates it (120 ms, from 4 px up; 8 px here at 2x), and goes
  // at once on Enter, as the host is removed.
  const boxIn = out(prog(t, T.click3 + 0.02, T.click3 + 0.14));
  style($("note"), t < T.enter + 0.04 ? boxIn : 0, `translateY(${(-8 * (1 - boxIn)).toFixed(2)}px)`);
  const chars = Math.round(NOTE.length * prog(t, ...T.typing));
  $("note-text").textContent = NOTE.slice(0, chars);
  $("note-ph").style.visibility = chars === 0 ? "visible" : "hidden";
  // The caret blinks while nothing is typed and holds still while typing, as a browser draws it.
  const typing = t >= T.typing[0] && t <= T.typing[1] + 0.1;
  $("note-caret").style.opacity = typing || (t - T.click3) % 1 < 0.5 ? "1" : "0";
  style($("enterkey"), span(t, T.enter - 0.4, T.enter + 0.3, 0.2, 0.25), `translateY(${6 * (1 - out(prog(t, T.enter - 0.4, T.enter - 0.2)))}px)`);
  $("enterkey").firstElementChild.classList.toggle("down", Math.abs(t - T.enter) < 0.1);

  const doc3In = out(prog(t, T.spec2 + 0.25, T.spec2 + 0.7));
  const endOut = inOut(prog(t, T.endOut, T.endOut + 0.4));
  style($("doc3"), Math.min(doc3In, 1 - endOut), `translateY(${18 * (1 - doc3In)}px) scale(${DOC6.s})`);
  const ed3In = outQuint(prog(t, T.spec2 + 0.25, T.spec2 + 1.0));
  style($("editor3"), Math.min(ed3In, 1 - endOut), `translateX(${60 * (1 - ed3In)}px)`);

  const arrows = [["arrow1", T.arrow1, "loc1", "code1", docOut], ["arrow2", T.arrow2, "loc2", "code2", docOut], ["arrow3", T.arrow3, "loc3", "code3", endOut]];
  for (const [g, [a, b], loc, code, gone] of arrows) {
    const p = inOut(prog(t, a, b));
    const { path, len } = L[g];
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${(len * (1 - p)).toFixed(2)}`;
    const on = p > 0 ? 1 : 0;
    const gop = Math.min(on, 1 - gone);
    style($(g), gop);
    $(g).querySelector(".head").style.opacity = out(prog(p, 0.85, 1)).toFixed(3);
    const spark = $(g).querySelector(".spark");
    const pt = path.getPointAtLength(len * p);
    spark.setAttribute("cx", pt.x.toFixed(2));
    spark.setAttribute("cy", pt.y.toFixed(2));
    spark.style.opacity = (p > 0 && p < 1 ? Math.min(1, p * 8, (1 - p) * 8) : 0).toFixed(3);
    $(loc).style.setProperty("--hl", out(prog(t, a - 0.15, a + 0.15)).toFixed(3));
    const hl = out(prog(t, b - 0.1, b + 0.35));
    const row = $(code).querySelector(".row.hot");
    row.querySelector(".hlbar").style.width = `${(100 * hl).toFixed(2)}%`;
    row.classList.toggle("on", hl > 0.2);
  }
}

// ---------------------------------------------------------------- start

window.DURATION = DURATION;
window.ready = (async () => {
  buildChart();
  buildWords("said1", WORDS1);
  buildWords("said2", WORDS2);
  $("note-quote").textContent = NOTE;
  jump = window.PC.Jump($("stage"), {
    id: "jump",
    html: ['<a class="stat-link"', '   href="/reports/revenue">', "  View report</a>"],
    file: "src/pages/Dashboard.tsx", url: "../../../dev/examples/react-dashboard/src/pages/Dashboard.tsx", from: 9, to: 13, hot: 11, mark: '"Revenue"',
    card: { x: 90, y: 456, w: 600 }, pane: { x: 740, y: 356, w: 800 }, htmlSize: 30, codeSize: 26, codeLine: 46,
  });
  await Promise.all([
    jump.load(),
    buildCode("code1", "../../../dev/examples/react-dashboard/src/pages/Dashboard.tsx", 6, 15, 11),
    buildCode("code2", "../../../dev/examples/react-dashboard/src/components/OrdersTable.tsx", 17, 25, 22),
    buildCode("code3", "../../../dev/examples/react-dashboard/src/components/OrdersTable.tsx", 25, 35, 31),
    document.fonts.ready,
    ...["400 16px Inter", "500 16px Inter", "600 16px Inter", "700 16px Inter", "800 16px Inter", "400 16px 'JetBrains Mono'", "600 16px 'JetBrains Mono'", "700 16px 'JetBrains Mono'"].map((f) => document.fonts.load(f).catch(() => {})),
    ...[...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))),
  ]);
  measure();
  jump.measure();
  window.renderAt = renderAt;
  renderAt(0);

  if (!/[?&]capture\b/.test(location.search)) {
    // Interactive preview: fit the stage to the window; #t=3.2 holds one instant, otherwise it loops.
    const fit = () => { $("stage").style.transform = `scale(${Math.min(innerWidth / 1600, innerHeight / 900)})`; };
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
  return DURATION;
})();
