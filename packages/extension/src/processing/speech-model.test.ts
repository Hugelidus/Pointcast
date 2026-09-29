import { defaultDtype } from "@pointcast/transcribe";
import { describe, expect, it } from "vitest";
import { modelKey, SPEECH_MODELS, speechModel } from "./speech-model";

describe("speech models", () => {
  it("runs whisper-base for Fast and whisper-small for Accurate", () => {
    expect(speechModel("fast").id).toBe("Xenova/whisper-base");
    expect(speechModel("accurate").id).toBe("Xenova/whisper-small");
  });

  it("uses the precision @pointcast/transcribe gives each model, so the CLI and the extension agree", () => {
    for (const model of Object.values(SPEECH_MODELS)) expect(model.dtype).toEqual(defaultDtype(model.id));
  });

  it("keys the learned stats by model and precision", () => {
    expect(modelKey(SPEECH_MODELS.fast)).toBe("Xenova/whisper-base:fp32");
    expect(modelKey(SPEECH_MODELS.accurate)).toBe("Xenova/whisper-small:encoder_model=fp32,decoder_model_merged=q8");
  });
});
