import { describe, expect, it } from "vitest";
import { chosenLanguage, DEFAULT_SETTINGS, languageName, nameOrFallback, parseSettings, WHISPER_LANGUAGES } from "./settings";

describe("settings", () => {
  it("defaults to auto-detection, no audio, a notification, and the handoff to a running MCP server", () => {
    expect(parseSettings(undefined)).toEqual({ language: "auto", keepAudio: false, notify: true, handoff: true });
    expect(chosenLanguage(DEFAULT_SETTINGS)).toBeUndefined();
  });

  it("keeps valid values and drops a language Whisper does not know", () => {
    expect(parseSettings({ language: "es", keepAudio: true, notify: false, handoff: false })).toEqual({
      language: "es",
      keepAudio: true,
      notify: false,
      handoff: false,
    });
    expect(parseSettings({ language: "klingon" }).language).toBe("auto");
    expect(chosenLanguage({ ...DEFAULT_SETTINGS, language: "es" })).toBe("es");
  });

  it("keeps the handoff on unless it was turned off: settings saved before 0.2.0 have no such field", () => {
    expect(parseSettings({ language: "es", keepAudio: true, notify: false }).handoff).toBe(true);
    expect(parseSettings({ handoff: "no" }).handoff).toBe(true);
  });

  it("names the languages for the picker", () => {
    expect(WHISPER_LANGUAGES).toHaveLength(99);
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("en")).toBe("English");
  });

  it("names every language even where the browser has no name for it (Chrome showed \"ba\" and \"bo\")", () => {
    // Chrome's trimmed ICU gives the code back.
    expect(nameOrFallback("ba", "ba")).toBe("Bashkir");
    expect(nameOrFallback("bo", undefined)).toBe("Tibetan");
    expect(nameOrFallback("jw", "jw")).toBe("Javanese");
    expect(nameOrFallback("es", "Spanish")).toBe("Spanish");
    expect(nameOrFallback("xx", "xx")).toBe("xx");
    for (const code of WHISPER_LANGUAGES) expect(nameOrFallback(code, code)).not.toBe(code);
  });
});
