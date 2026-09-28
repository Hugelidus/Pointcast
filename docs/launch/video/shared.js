// Shared by the demo (index.html + timeline.js) and the short clips (clips.html + clips.js): source
// highlighting, the real source files, and "the jump": the element's HTML, greyed out and struck
// through, then an arrow to the line of source that makes it. Everything is drawn as a pure function
// of time, like the rest of the animation.
"use strict";

(() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const out = (x) => 1 - Math.pow(1 - x, 3);
  const outQuint = (x) => 1 - Math.pow(1 - x, 5);

  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /** Just enough TSX highlighting for a dozen lines. */
  function highlight(line) {
    const re = /(\/\*\*.*?\*\/|\/\/.*$)|("(?:[^"\\]|\\.)*")|\b(import|export|from|function|return|const|interface|type)\b|(<\/?[A-Za-z][A-Za-z]*|\/>)|\b([A-Za-z]+)(?==)|\b(\d+)\b/g;
    let html = "";
    let last = 0;
    for (const m of line.matchAll(re)) {
      html += escapeHtml(line.slice(last, m.index));
      const cls = m[1] ? "com" : m[2] ? "str" : m[3] ? "kw" : m[4] ? "tag" : m[5] ? "attr" : "num";
      html += `<span class="tok-${cls}">${escapeHtml(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return html + escapeHtml(line.slice(last));
  }

  /** The lines of a real file of the example app (dev/examples/react-dashboard), fetched once. */
  const files = new Map();
  function sourceLines(url) {
    if (!files.has(url)) {
      files.set(url, fetch(url)
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
        .then((text) => text.replace(/\r\n/g, "\n").split("\n"))
        .catch((error) => { console.error(`could not read ${url}: ${error}`); return []; }));
    }
    return files.get(url);
  }

  /**
   * Rows `from`..`to` of a file, line `hot` ready to be highlighted; `mark` (a literal of that line)
   * is wrapped in a span.mark so it can glow.
   */
  async function codeRows(url, from, to, hot, mark) {
    const lines = await sourceLines(url);
    const rows = [];
    for (let n = from; n <= to; n++) {
      let src = highlight(lines[n - 1] ?? "");
      if (n === hot && mark) src = src.replace(escapeHtml(mark), `<span class="mark">${escapeHtml(mark)}</span>`);
      rows.push(`<div class="row${n === hot ? " hot" : ""}" data-n="${n}">${n === hot ? '<div class="hlbar"></div>' : ""}<span class="num">${n}</span><span class="src">${src}</span></div>`);
    }
    return rows.join("");
  }

  function setStyle(el, opacity, transform) {
    el.style.opacity = opacity.toFixed(4);
    el.style.visibility = opacity <= 0.001 ? "hidden" : "visible";
    if (transform !== undefined) el.style.transform = transform;
  }

  /**
   * The jump. `opts`: id (prefix), html (the element as the browser has it, one string or lines),
   * file, url, from, to, hot, mark, and where things go: card {x, y, w}, pane {x, y, w}, font sizes.
   * mount() writes the markup into `stage`; measure() lays out the arrow once the fonts are in;
   * render(t, gone) draws the instant t seconds after the jump starts (t large = finished), faded
   * out by `gone` (0..1).
   */
  function Jump(stage, opts) {
    const id = opts.id;
    const htmlLines = Array.isArray(opts.html) ? opts.html : [opts.html];
    const wrap = document.createElement("div");
    wrap.className = "jmp";
    wrap.id = id;
    wrap.style.setProperty("--html-size", `${opts.htmlSize ?? 38}px`);
    wrap.style.setProperty("--code-size", `${opts.codeSize ?? 27}px`);
    wrap.style.setProperty("--code-line", `${opts.codeLine ?? 46}px`);
    wrap.innerHTML = `
      <div class="jmp-html" style="left:${opts.card.x}px; top:${opts.card.y}px; width:${opts.card.w}px">
        <div class="jmp-cap">${opts.htmlCaption ?? "The browser has"}</div>
        <div class="jmp-card"><div class="jmp-code">${htmlLines.map((l) => `<div class="jmp-l"><span>${escapeHtml(l)}</span><i class="jmp-strike"></i></div>`).join("")}</div></div>
      </div>
      <div class="jmp-src" style="left:${opts.pane.x}px; top:${opts.pane.y}px; width:${opts.pane.w}px">
        <div class="jmp-cap">${opts.srcCaption ?? "Your agent gets"}</div>
        <div class="pane"><div class="tab"><b></b>${escapeHtml(opts.file)}<span class="jmp-at">:${opts.hot}</span></div><div class="code"></div></div>
      </div>
      <svg class="jmp-arrow" width="${opts.stageW ?? 1600}" height="${opts.stageH ?? 900}" aria-hidden="true">
        <defs>
          <linearGradient id="${id}-ag" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#f472b6"/></linearGradient>
          <filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <path class="shaft" fill="none" stroke="url(#${id}-ag)" stroke-width="5" stroke-linecap="round" filter="url(#${id}-glow)"/>
        <path class="head" fill="#f472b6"/>
        <circle class="spark" r="8" fill="#fff" filter="url(#${id}-glow)"/>
      </svg>`;
    stage.appendChild(wrap);
    const q = (s) => wrap.querySelector(s);
    const L = {};

    return {
      el: wrap,
      async load() {
        q(".code").innerHTML = await codeRows(opts.url, opts.from, opts.to, opts.hot, opts.mark);
      },
      measure() {
        const s = stage.getBoundingClientRect();
        const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }; };
        const card = rel(q(".jmp-card"));
        const row = rel(q(".row.hot"));
        // From the card's right edge to the hot row's left edge; from its bottom when it sits above.
        const beside = card.x + card.w < row.x - 40;
        const x0 = beside ? card.x + card.w + 16 : card.x + card.w * 0.5;
        const y0 = beside ? card.y + card.h / 2 : card.y + card.h + 14;
        const x1 = row.x - 10, y1 = row.y + row.h / 2;
        const path = q(".shaft");
        const d = beside
          ? `M${x0} ${y0} C${x0 + (x1 - x0) * 0.5} ${y0} ${x1 - (x1 - x0) * 0.5} ${y1} ${x1 - 14} ${y1}`
          : `M${x0} ${y0} C${x0} ${y1} ${x0} ${y1} ${x1 - 14} ${y1}`;
        path.setAttribute("d", d);
        q(".head").setAttribute("d", `M${x1 - 18} ${y1 - 11} L${x1 + 2} ${y1} L${x1 - 18} ${y1 + 11} Z`);
        L.path = path;
        L.len = path.getTotalLength();
      },
      /** Seconds after the jump starts: the HTML, its strike, the source, the arrow, the line. */
      render(t, gone = 0) {
        const keep = 1 - inOut(clamp(gone));
        const htmlIn = outQuint(prog(t, 0, 0.45));
        const strike = inOut(prog(t, 0.55, 0.95));
        setStyle(q(".jmp-html"), Math.min(htmlIn, keep), `translateY(${(18 * (1 - htmlIn)).toFixed(2)}px)`);
        q(".jmp-html").style.setProperty("--grey", strike.toFixed(3));
        for (const s of wrap.querySelectorAll(".jmp-strike")) s.style.transform = `scaleX(${strike.toFixed(4)})`;
        const srcIn = outQuint(prog(t, 0.75, 1.3));
        setStyle(q(".jmp-src"), Math.min(srcIn, keep), `translateX(${(50 * (1 - srcIn)).toFixed(2)}px)`);
        const p = inOut(prog(t, 1.05, 1.6));
        L.path.style.strokeDasharray = `${L.len}`;
        L.path.style.strokeDashoffset = `${(L.len * (1 - p)).toFixed(2)}`;
        setStyle(q(".jmp-arrow"), Math.min(p > 0 ? 1 : 0, keep));
        q(".head").style.opacity = out(prog(p, 0.85, 1)).toFixed(3);
        const pt = L.path.getPointAtLength(L.len * p);
        const spark = q(".spark");
        spark.setAttribute("cx", pt.x.toFixed(2));
        spark.setAttribute("cy", pt.y.toFixed(2));
        spark.style.opacity = (p > 0 && p < 1 ? Math.min(1, p * 8, (1 - p) * 8) : 0).toFixed(3);
        const hl = out(prog(t, 1.5, 1.9));
        const row = q(".row.hot");
        row.querySelector(".hlbar").style.width = `${(100 * hl).toFixed(2)}%`;
        row.classList.toggle("on", hl > 0.2);
        q(".jmp-at").style.opacity = hl.toFixed(3);
        const mark = row.querySelector(".mark");
        if (mark) mark.style.setProperty("--m", out(prog(t, 1.75, 2.1)).toFixed(3));
      },
    };
  }

  window.PC = { clamp, prog, inOut, out, outQuint, escapeHtml, highlight, codeRows, setStyle, Jump };
})();
