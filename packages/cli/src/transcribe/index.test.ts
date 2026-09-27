import { DEFAULT_MODEL } from "@pointcast/transcribe";
import { describe, expect, it } from "vitest";
import { createEngine, LOCAL_DEFAULT_MODEL } from "./index";

describe("createEngine", () => {
  it("names the local engine without loading transformers.js", () => {
    expect(LOCAL_DEFAULT_MODEL).toBe(DEFAULT_MODEL);
    expect(createEngine("local").name).toBe(`local:${DEFAULT_MODEL}`);
    expect(createEngine("local", { model: "Xenova/whisper-small" }).name).toBe("local:Xenova/whisper-small");
  });
});
