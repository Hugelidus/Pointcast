// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createUndoFeedback } from "./undo-feedback";

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
    expect(deps.notice).toHaveBeenCalledWith("Undone: h1 «Orders» · Alt+click");
  });

  it("only speaks up in a page the user can see when another page captured the gesture", () => {
    const hidden = setup(false);
    hidden.feedback.undone({ id: "e1", summary: "button «Export» · Alt+click", at: 1 });
    expect(hidden.deps.flash).not.toHaveBeenCalled();
    expect(hidden.deps.notice).not.toHaveBeenCalled();

    const visible = setup(true);
    visible.feedback.undone({ id: "e1", summary: "button «Export» · Alt+click", at: 1 });
    expect(visible.deps.flash).not.toHaveBeenCalled();
    expect(visible.deps.notice).toHaveBeenCalledWith("Undone: button «Export» · Alt+click");
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
