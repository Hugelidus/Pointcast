// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createUndoFeedback, readableSummary } from "./undo-feedback";

function setup(visible = false) {
  document.body.innerHTML = '<button id="export">Export</button><h1 id="title">Orders</h1>';
  const deps = { flash: vi.fn(), notice: vi.fn(), isVisible: () => visible };
  return { deps, feedback: createUndoFeedback(deps), byId: (id: string) => document.getElementById(id) as Element };
}

describe("createUndoFeedback", () => {
  it("flashes the element this page captured for the undone event, and says what was undone", () => {
    const { deps, feedback, byId } = setup();
    feedback.remember("e1", byId("export"));
    feedback.remember("e2", byId("title"));

    feedback.undone({ id: "e2", summary: "h1 «Orders» · Alt+click", at: 1 });
    expect(deps.flash).toHaveBeenCalledWith(byId("title"));
    expect(deps.notice).toHaveBeenCalledWith("Undone: heading “Orders”");
  });

  it("only speaks up in a page the user can see when another page captured the gesture", () => {
    const hidden = setup(false);
    hidden.feedback.undone({ id: "e1", summary: "button «Export» · Alt+click", at: 1 });
    expect(hidden.deps.flash).not.toHaveBeenCalled();
    expect(hidden.deps.notice).not.toHaveBeenCalled();

    const visible = setup(true);
    visible.feedback.undone({ id: "e1", summary: "button «Export» · Alt+click", at: 1 });
    expect(visible.deps.flash).not.toHaveBeenCalled();
    expect(visible.deps.notice).toHaveBeenCalledWith("Undone: button “Export”");
  });

  it("forgets the ids of the previous recording, and an id once it was undone", () => {
    const { deps, feedback, byId } = setup();
    feedback.remember("e1", byId("export"));
    feedback.reset();
    feedback.undone({ id: "e1", summary: "x", at: 1 });
    expect(deps.flash).not.toHaveBeenCalled();

    feedback.remember("e1", byId("title"));
    feedback.undone({ id: "e1", summary: "x", at: 2 });
    feedback.undone({ id: "e1", summary: "x", at: 3 });
    expect(deps.flash).toHaveBeenCalledTimes(1);
  });

  it("does not flash an element that left the page", () => {
    const { deps, feedback, byId } = setup();
    const button = byId("export");
    feedback.remember("e1", button);
    button.remove();
    feedback.undone({ id: "e1", summary: "button «Export» · Alt+click", at: 1 });
    expect(deps.flash).not.toHaveBeenCalled();
    expect(deps.notice).toHaveBeenCalled();
  });
});

describe("readableSummary", () => {
  it("names elements in words, not HTML tags, and the gesture only when it is not Alt+click", () => {
    expect(readableSummary("a «View report» · Alt+click")).toBe("link “View report”");
    expect(readableSummary("input «Email» · click")).toBe("field “Email” · click");
    expect(readableSummary("th «Quantity» · selection")).toBe("column header “Quantity” · selection");
  });

  it("leaves out a tag it has no word for", () => {
    expect(readableSummary("span «3» · Alt+click")).toBe("“3”");
    expect(readableSummary("my-widget · click")).toBe("element · click");
    expect(readableSummary("button · Alt+click")).toBe("button");
  });

  it("passes through a summary that is already in words, or in another format", () => {
    expect(readableSummary("link “View report”")).toBe("link “View report”");
    expect(readableSummary("link · click")).toBe("link · click");
    expect(readableSummary("x")).toBe("x");
  });
});
