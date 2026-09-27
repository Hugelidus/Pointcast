import { describe, expect, it } from "vitest";
import { chosenLanguage, DEFAULT_SETTINGS, languageName, parseSettings, WHISPER_LANGUAGES } from "./settings";

describe("settings", () => {
  it("defaults to auto-detection, no audio, and a notification", () => {
    expect(parseSettings(undefined)).toEqual({ language: "auto", keepAudio: false, notify: true });
    expect(chosenLanguage(DEFAULT_SETTINGS)).toBeUndefined();
  });

  it("keeps valid values and drops a language Whisper does not know", () => {
    expect(parseSettings({ language: "es", keepAudio: true, notify: false })).toEqual({ language: "es", keepAudio: true, notify: false });
    expect(parseSettings({ language: "klingon" }).language).toBe("auto");
    expect(chosenLanguage({ ...DEFAULT_SETTINGS, language: "es" })).toBe("es");
  });

  it("names the languages for the picker", () => {
    expect(WHISPER_LANGUAGES).toHaveLength(99);
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("en")).toBe("English");
  });
});
