import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getElement, validEventIds } from "./get-element";

const FIXTURE = join(__dirname, "../../../../dev/fixtures/sessions/e2e-es-v2");

describe("getElement", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pointcast-mcp-element-"));
    cpSync(FIXTURE, dir, { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the full ElementInfo for a captured event by id", async () => {
    const { event, warning } = await getElement(dir, "e1");
    expect(warning).toBeUndefined();
    expect(event).toMatchObject({
      id: "e1",
      gesture: "select",
      element: { tag: "th", text: "Quantity" },
    });
  });

  it("fails with the range of valid event ids when the event id is unknown", async () => {
    await expect(getElement(dir, "e999")).rejects.toThrowError(
      'No event "e999" in recording 2026-09-26_20-29-01: its event ids are e1…e10, in the order the user pointed.',
    );
  });

  it("lists ids that are not the extension's own sequence, and says when there are none", () => {
    expect(validEventIds([{ id: "e1" }])).toBe('its only event id is "e1".');
    expect(validEventIds([{ id: "e1" }, { id: "e3" }])).toBe("its event ids are e1, e3.");
    expect(validEventIds([])).toBe("it has no events (nothing was pointed at).");
  });
});
