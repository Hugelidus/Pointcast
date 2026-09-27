import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getElement } from "./get-element";

const FIXTURE = join(__dirname, "../../../../fixtures/sessions/e2e-es-v2");

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

  it("fails with the list of valid event ids when the event id is unknown", async () => {
    await expect(getElement(dir, "e999")).rejects.toThrowError(/No event "e999".*e1, e2/s);
  });
});
