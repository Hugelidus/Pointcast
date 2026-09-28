// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { describeElement, findSource, readablePath } from "./describe";
import { loadPlayground } from "./test-utils/playground";

const index = loadPlayground("index.html").window.document;
const q = (css: string, doc: Document = index): Element => {
  const found = doc.querySelector(css);
  if (found === null) throw new Error(`no element for ${css}`);
  return found;
};

describe("describeElement on the playground", () => {
  it("reports Export with its source on the parent (plan step 7)", () => {
    expect(describeElement(q("#export-btn"))).toEqual({
      tag: "button",
      text: "Export",
      selector: "#export-btn",
      context: "Orders",
      selectorUnique: true,
      path: "main › section#orders › button#export-btn",
      html: '<button type="button" id="export-btn" class="primary Toolbar_export__3xKz1"><svg/> Export</button>',
      source: { file: "src/components/Toolbar.tsx", line: 8, attribute: "data-source", distance: 1 },
    });
  });

  it("describes a column header with the readable path of D3", () => {
    const info = describeElement(q("#orders-table thead th:nth-child(3)"));
    expect(info).toMatchObject({
      tag: "th",
      text: "Quantity",
      path: "main › section#orders › table#orders-table › thead › tr › th[3]",
      html: "<th>Quantity</th>",
      selectorUnique: true,
    });
    expect(info.hint).toBeUndefined();
  });

  it("gives table cells their column header as hint", () => {
    const cell = q("#orders-table tbody tr:nth-child(2) td:nth-child(3)");
    expect(describeElement(cell)).toMatchObject({ text: "1", hint: "Quantity" });
  });

  it("gives submit buttons their form as hint", () => {
    expect(describeElement(q("#settings-form button"))).toMatchObject({ text: "Save", hint: "form#settings-form" });
    expect(describeElement(q("#export-btn")).hint).toBeUndefined(); // type="button"
  });

  it("reads labels from aria-label, aria-labelledby and <label for>", () => {
    expect(describeElement(q('[aria-label="More actions"]'))).toMatchObject({ text: "⋯", label: "More actions" });
    expect(describeElement(q("#orders")).label).toBe("Orders");
    expect(describeElement(q("#display-name"))).toMatchObject({ text: "", label: "Display name" });
  });

  it("separates the texts of siblings that layout sets apart", () => {
    document.body.innerHTML = '<a id="messages" style="display: flex"><span>Messages</span><span>3</span></a>';
    expect(describeElement(document.getElementById("messages") as Element).text).toBe("Messages 3");

    document.body.innerHTML = '<a id="grid" style="display: grid"><span>Sem 2</span><span>26 oct</span></a>';
    expect(describeElement(document.getElementById("grid") as Element).text).toBe("Sem 2 26 oct");

    document.body.innerHTML = '<a id="chip"><span>Messages</span><span style="display: inline-block">3</span></a>';
    expect(describeElement(document.getElementById("chip") as Element).text).toBe("Messages 3");
  });

  it("keeps the texts of inline siblings in a line of text together", () => {
    document.body.innerHTML = '<p id="price"><span>$</span><span>45</span></p>';
    expect(describeElement(document.getElementById("price") as Element).text).toBe("$45");

    document.body.innerHTML = '<p id="word"><b>Hel</b><i>lo</i></p>';
    expect(describeElement(document.getElementById("word") as Element).text).toBe("Hello");
  });

  it("names landmarks without generated ids", () => {
    expect(describeElement(q('[aria-label="More actions"]')).path).toBe("main › section#orders › button«More actions»");
    expect(readablePath(q("#orders-table tbody tr:nth-child(3) button"))).toBe(
      "main › section#orders › table#orders-table › tbody › tr[3] › td[5] › button",
    );
    expect(readablePath(index.body)).toBe("body");
  });

  it("keeps tag, selector, path and label of sensitive fields but no value", () => {
    const password = q("#password") as HTMLInputElement;
    password.value = "CANARY-7391";
    password.setAttribute("value", "CANARY-7391");
    expect(describeElement(password)).toEqual({
      tag: "input",
      text: "",
      label: "Password",
      context: "Settings",
      selector: "#password",
      selectorUnique: true,
      path: "main › section«Settings» › form#settings-form › input#password",
      html: '<input id="password" name="password" type="password">',
      sensitive: true,
    });
  });

  it("redacts a data-sensitive block and keeps it out of its ancestors' text", () => {
    const note = describeElement(q(".private-note"));
    expect(note).toMatchObject({ text: "", html: '<div class="private-note">[redacted]</div>', sensitive: true });
    const form = JSON.stringify(describeElement(q("#settings-form")));
    expect(form).not.toContain("Private note");
    expect(form).not.toContain("Jane Doe");
    expect(form).not.toContain("Default textarea content");
  });

  // PRIVACY ATTACK (D8): a sensitive field's `text` is blanked, but nothing stopped its own
  // aria-label/title/placeholder/alt — often mirroring the current value in real apps — from
  // being read into `label`, since labelOf() never checked the element's own sensitivity.
  it("never puts a sensitive element's own aria-label/title/placeholder/alt into its label", () => {
    document.body.innerHTML =
      '<input id="a" type="password" aria-label="CANARY-7391">' +
      '<input id="b" autocomplete="cc-number" title="CANARY-7391">' +
      '<input id="c" data-sensitive placeholder="CANARY-7391">' +
      '<input id="d" type="text" alt="CANARY-7391" autocomplete="one-time-code">';
    for (const id of ["a", "b", "c", "d"]) {
      const info = describeElement(document.getElementById(id) as Element);
      expect(info.label, id).not.toBe("CANARY-7391");
      expect(JSON.stringify(info)).not.toContain("CANARY-7391");
    }
  });

  it("still reads label from an element's own aria-label/title when it is not sensitive", () => {
    document.body.innerHTML = '<button id="go" aria-label="Export orders">Go</button>';
    expect(describeElement(document.getElementById("go") as Element).label).toBe("Export orders");
  });

  // PRIVACY ATTACK (D8/D3): the readable path and the CSS selector are always kept for sensitive
  // elements too, and both used to read aria-label straight off the element (or an ancestor)
  // without checking sensitivity — the value would leak through `path`/`selector` even though
  // `text` and `html` were correctly redacted.
  it("never puts a sensitive element's aria-label into its path or selector", () => {
    document.body.innerHTML = '<input id="e" type="password" aria-label="CANARY-7391">';
    const info = describeElement(document.getElementById("e") as Element);
    expect(info.path).not.toContain("CANARY-7391");
    expect(info.selector).not.toContain("CANARY-7391");
  });

  it("never puts a data-sensitive ancestor's aria-label into a descendant's path", () => {
    document.body.innerHTML = '<section data-sensitive aria-label="CANARY-7391"><span id="f">x</span></section>';
    expect(describeElement(document.getElementById("f") as Element).path).not.toContain("CANARY-7391");
    // Nor into its context (the title of the container around it).
    expect(JSON.stringify(describeElement(document.getElementById("f") as Element))).not.toContain("CANARY-7391");
  });

  it("finds the nearest source attribute and its distance", () => {
    const other = loadPlayground("other.html").window.document;
    expect(findSource(q("article button", other), ["data-source"])).toEqual({
      file: "src/pages/Customers.tsx",
      line: 21,
      attribute: "data-source",
      distance: 2,
    });
    expect(describeElement(q("#orders-title")).source).toBeUndefined();
  });
});

describe("context: the title of the card or section around an element", () => {
  const contextOf = (html: string, css: string, options = {}): string | undefined => {
    document.body.innerHTML = html;
    return describeElement(document.querySelector(css) as Element, options).context;
  };

  it("names the playground's sections, and skips a title that is the element itself", () => {
    expect(describeElement(q("#export-btn")).context).toBe("Orders"); // aria-labelledby
    expect(describeElement(q("#orders-table tbody tr:nth-child(2) td:nth-child(3)")).context).toBe("Orders");
    expect(describeElement(q('section[aria-label="Order notes"] p')).context).toBe("Order notes"); // aria-label
    expect(describeElement(q("#orders-title")).context).toBeUndefined(); // the heading itself; <main> ends the search
  });

  it("says a tab panel is a tab, so it does not read as a card of the same name", () => {
    const tabs = `<main><div role="tablist"><button role="tab" id="t1">Overview</button></div>
      <div role="tabpanel" aria-labelledby="t1"><div class="card"><div>Recent Sales</div><p id="p">You made 265 sales.</p></div></div></main>`;
    expect(contextOf(tabs, "#p")).toBe("Overview tab");
  });

  // The eval's flowbite case: two cards render the same `More` link, «Sales Report».
  const CARDS = `<main><div class="grid">
    <div class="card chart-card">
      <div class="head"><div><h3>$45,385</h3><p id="sub">Sales this week</p></div><span>12.5%</span></div>
      <div class="chart"><svg><rect/></svg></div>
      <div class="foot"><button>Last 7 days</button><div class="more"><a id="first" href="#top">Sales Report</a></div></div>
    </div>
    <div class="card report-card">
      <div class="head"><h3>Sales by category</h3><span>Desktop PC</span></div>
      <div class="foot"><div class="more"><a id="second" href="#top">Sales Report</a></div></div>
    </div>
  </div></main>`;

  it("tells apart two instances of a shared component by their card's heading and subtitle", () => {
    expect(contextOf(CARDS, "#first")).toBe("$45,385 · Sales this week");
    expect(contextOf(CARDS, "#second")).toBe("Sales by category · Desktop PC");
    // The subtitle itself: its heading, without repeating the subtitle.
    expect(contextOf(CARDS, "#sub")).toBe("$45,385");
  });

  it("never borrows the heading of another card, of a later block or of the page", () => {
    // Another item of the same grid (same tag and class): its heading is not this card's.
    const grid = `<main><div class="grid">
      <div class="card"><h5>New products</h5><span>2,340</span></div>
      <div class="card"><h5>Users</h5><span>4,420</span></div>
      <div class="card"><span id="x">4,420</span></div>
    </div></main>`;
    expect(contextOf(grid, "#x")).toBeUndefined();
    // A big block (a whole card with a chart) holding a heading, next to the element's block.
    const bars = Array.from({ length: 30 }, () => "<rect/>").join("");
    expect(contextOf(`<main><div><div class="a"><h3>Revenue</h3><svg>${bars}</svg></div><div class="b"><button id="y">Go</button></div></div></main>`, "#y")).toBeUndefined();
    // A heading after the element titles what follows it (here, the page's main content).
    expect(contextOf(`<div id="root"><aside><a id="l" href="/chats">Chats</a></aside><main><h1>Dashboard</h1></main></div>`, "#l")).toBeUndefined();
    // Nothing above <main>: the page title is not a card.
    expect(contextOf(`<main><h1>Dashboard</h1><div><button id="z">Download</button></div></main>`, "#z")).toBeUndefined();
  });

  it("is at most 60 characters, redacted on enabled sites and blank for sensitive text", () => {
    const long = "A very long card title that goes on and on well past sixty characters";
    const context = contextOf(`<section aria-label="${long}"><button id="b">Go</button></section>`, "#b");
    expect(context?.length).toBeLessThanOrEqual(60);
    expect(context?.endsWith("…")).toBe(true);
    const personal = `<article><h3>Invoices of bob@example.com</h3><button id="b">Pay</button></article>`;
    expect(contextOf(personal, "#b", { redactPersonalData: true })).toBe("Invoices of [redacted]");
    expect(contextOf(`<div><h3 data-sensitive>CANARY-7391</h3><button id="b">Go</button></div>`, "#b")).toBeUndefined();
  });
});

describe("itemLabel: the item a short value belongs to", () => {
  const itemLabelOf = (html: string, css: string, options = {}): string | undefined => {
    document.body.innerHTML = html;
    return describeElement(document.querySelector(css) as Element, options).itemLabel;
  };

  // dev/examples/react-dashboard's sidebar, as React renders it: no whitespace between the spans.
  const SIDEBAR = `<div id="root"><nav aria-label="Main"><ul>
    <li><a href="/orders"><span>Orders</span></a></li>
    <li><a href="/messages"><span>Messages</span><span class="badge">3</span></a></li>
  </ul></nav></div>`;

  it("names the link a badge sits in, without the badge's own text (the recording that asked for it)", () => {
    document.body.innerHTML = SIDEBAR;
    expect(describeElement(document.querySelector(".badge") as Element)).toMatchObject({
      text: "3",
      itemLabel: "Messages",
      context: "Main",
      path: "div#root › nav«Main» › ul › li[2] › span[2]",
    });
    // The words on both sides of the value stay apart.
    expect(itemLabelOf(`<ul><li><b>Top</b><span id="v">+5</span><b>sellers</b></li></ul>`, "#v")).toBe("Top sellers");
    expect(itemLabelOf(`<div role="listbox"><div role="option">Priority <i id="v">✓</i></div></div>`, "#v")).toBe("Priority");
  });

  it("gives a table cell its row's label, not the whole row", () => {
    const table = `<table><thead><tr><th>Order</th><th>Customer</th><th>Total</th></tr></thead><tbody>
      <tr><td>A-1042</td><td>Lina Torres</td><td id="total"><span id="amount">$128.00</span></td></tr>
      <tr><td id="qty">2</td><th scope="row">Lina Torres</th><td>$64.50</td></tr>
    </tbody></table>`;
    expect(itemLabelOf(table, "#total")).toBe("A-1042");
    expect(itemLabelOf(table, "#amount")).toBe("A-1042");
    expect(itemLabelOf(table, "#qty")).toBe("Lina Torres"); // its th[scope=row], before its first other cell
  });

  it("is absent for words, for a value alone in its item, and beyond a few levels", () => {
    expect(itemLabelOf(SIDEBAR, "a[href='/orders'] span")).toBeUndefined(); // «Orders» is words, not a value
    expect(itemLabelOf(`<ul class="pages"><li><button id="p">3</button></li></ul>`, "#p")).toBeUndefined();
    expect(itemLabelOf(`<button aria-label="Notifications"><svg></svg><span id="n">2+</span></button>`, "#n")).toBeUndefined();
    expect(itemLabelOf(`<li>Messages<div><div><div><div><span id="deep">3</span></div></div></div></div></li>`, "#deep")).toBeUndefined();
  });

  it("reads nothing sensitive, is at most 60 characters and redacted on enabled sites", () => {
    expect(itemLabelOf(`<li data-sensitive>CANARY-7391 <span id="s">3</span></li>`, "#s")).toBeUndefined();
    expect(itemLabelOf(`<li><span data-sensitive>CANARY-7391</span> <span id="s">3</span></li>`, "#s")).toBeUndefined();
    const long = itemLabelOf(`<li>${"A very long item label ".repeat(5)}<span id="s">3</span></li>`, "#s");
    expect(long?.length).toBeLessThanOrEqual(60);
    expect(long?.endsWith("…")).toBe(true);
    const personal = `<ul><li><a href="/inbox">bob@example.com <span id="s">3</span></a></li></ul>`;
    expect(itemLabelOf(personal, "#s", { redactPersonalData: true })).toBe("[redacted]");
  });
});

describe("source parsing", () => {
  function sourceOf(value: string, attributes = ["data-source"]) {
    document.body.innerHTML = `<div data-source="${value}" data-loc="x.vue:1"><b>x</b></div>`;
    return findSource(document.querySelector("b") as Element, attributes);
  }

  it("parses file:line:col", () => {
    expect(sourceOf("src/App.tsx:40:7")).toEqual({ file: "src/App.tsx", line: 40, column: 7, attribute: "data-source", distance: 1 });
  });

  // PRIVACY (D8): a drive letter makes the value absolute and machine-specific (unlike a plain
  // rooted path such as "/app/src/App.tsx"), so it is cut down to a project-relative path — the
  // line/column parsing around the drive letter's own ":" still has to work correctly.
  it("normalizes an absolute Windows path (drive letter) to a project-relative one", () => {
    expect(sourceOf("C:/app/src/App.tsx:12")).toMatchObject({ file: "src/App.tsx", line: 12 });
    expect(sourceOf("C:\\Users\\hugo\\project\\src\\components\\App.tsx:12")).toMatchObject({
      file: "src/components/App.tsx",
      line: 12,
    });
  });

  it("leaves a plain rooted path (no drive letter, no home prefix) unchanged", () => {
    expect(sourceOf("/app/dist/App.tsx:12")).toMatchObject({ file: "/app/dist/App.tsx", line: 12 });
  });

  it("keeps a bare file when there is no line", () => {
    expect(sourceOf("src/App.tsx")).toEqual({ file: "src/App.tsx", attribute: "data-source", distance: 1 });
  });

  it("checks the configured attributes in order at each level", () => {
    expect(sourceOf("src/App.tsx:1", ["data-loc", "data-source"])).toMatchObject({ file: "x.vue", attribute: "data-loc" });
  });
});
