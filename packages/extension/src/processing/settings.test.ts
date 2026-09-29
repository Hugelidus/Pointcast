import { describe, expect, it } from "vitest";
import { chosenLanguage, DEFAULT_SETTINGS, languageName, nameOrFallback, parseSettings, WHISPER_LANGUAGES } from "./settings";

describe("settings", () => {
  it("defaults to auto-detection, no audio, a notification, and the handoff to a running MCP server", () => {
    expect(parseSettings(undefined)).toEqual({
      language: "auto",
      keepAudio: false,
      notify: true,
      handoff: true,
      inputMode: "voice",
      captureErrors: true,
      quality: "fast",
    });
    expect(chosenLanguage(DEFAULT_SETTINGS)).toBeUndefined();
  });

  it("keeps valid values and drops a language Whisper does not know", () => {
    expect(parseSettings({ language: "es", keepAudio: true, notify: false, handoff: false })).toEqual({
      language: "es",
      keepAudio: true,
      notify: false,
      handoff: false,
      inputMode: "voice",
      captureErrors: true,
      quality: "fast",
    });
    expect(parseSettings({ language: "klingon" }).language).toBe("auto");
    expect(chosenLanguage({ ...DEFAULT_SETTINGS, language: "es" })).toBe("es");
  });

  it("keeps the handoff on unless it was turned off: settings saved before 0.2.0 have no such field", () => {
    expect(parseSettings({ language: "es", keepAudio: true, notify: false }).handoff).toBe(true);
    expect(parseSettings({ handoff: "no" }).handoff).toBe(true);
  });

  it("remembers typed mode, and reads voice from settings saved before it existed or from a bad value (D12)", () => {
    expect(parseSettings({ inputMode: "typed" }).inputMode).toBe("typed");
    expect(parseSettings({ inputMode: "voice" }).inputMode).toBe("voice");
    expect(parseSettings({ language: "es", keepAudio: true, notify: false, handoff: false }).inputMode).toBe("voice");
    expect(parseSettings({ inputMode: "keyboard" }).inputMode).toBe("voice");
  });

  it("captures page errors unless it was turned off: settings saved before 0.5.0 have no such field (D13)", () => {
    expect(parseSettings({ captureErrors: false }).captureErrors).toBe(false);
    expect(parseSettings({ language: "es", keepAudio: true, notify: false, handoff: false }).captureErrors).toBe(true);
    expect(parseSettings({ captureErrors: "no" }).captureErrors).toBe(true);
  });

  it("transcribes fast unless Accurate was chosen: settings saved before it existed have no such field", () => {
    expect(parseSettings({ quality: "accurate" }).quality).toBe("accurate");
    expect(parseSettings({ quality: "fast" }).quality).toBe("fast");
    expect(parseSettings({ language: "es", keepAudio: true }).quality).toBe("fast");
    expect(parseSettings({ quality: "best" }).quality).toBe("fast");
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
