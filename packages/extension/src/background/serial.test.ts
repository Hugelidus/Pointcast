import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serial";

describe("createSerialQueue", () => {
  it("runs tasks one at a time in call order, and a failure does not block the next", async () => {
    const serially = createSerialQueue();
    const log: string[] = [];
    const task = (name: string, ms: number, fail = false) => async () => {
      log.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`${name} end`);
      if (fail) throw new Error(name);
      return name;
    };
    const results = await Promise.allSettled([serially(task("a", 20, true)), serially(task("b", 1)), serially(task("c", 5))]);
    expect(log).toEqual(["a start", "a end", "b start", "b end", "c start", "c end"]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  });
});
