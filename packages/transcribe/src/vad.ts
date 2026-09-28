import { PreTrainedModel, Tensor } from "@huggingface/transformers";
import { SAMPLE_RATE } from "./chunks";
import { VAD_FRAME } from "./speech";

/**
 * Silero VAD v5 (MIT), the voice activity detector faster-whisper and WhisperX use. 2.2 MB of
 * fp32 weights, so it costs nothing next to Whisper's 294 MB, and it runs through the ONNX
 * Runtime transformers.js already brings: no new code in the extension (MV3 forbids remote
 * code), and its weights are downloaded and cached exactly like Whisper's, from the same host.
 * The repo has no config.json, so the model type is given here ("custom": a plain ONNX session,
 * loaded by the base class, as AutoModel would after warning that it does not know the type).
 *
 * Speed: one step per 32 ms of audio, about 0.2 ms each in Node (60 ms for 11.6 s of audio).
 */
export const VAD_MODEL = "onnx-community/silero-vad";

/** Silero v5 looks at the previous 64 samples too (its own OnnxWrapper prepends them). */
const CONTEXT = 64;

/** The parts of the model this calls; the library's types do not describe a custom model. */
type SileroModel = PreTrainedModel &
  ((inputs: { input: Tensor; sr: Tensor; state: Tensor }) => Promise<{ output: Tensor; stateN: Tensor }>);

export class SileroVad {
  private constructor(private readonly model: SileroModel) {}

  /**
   * One thread: a model this small gains nothing from more (applies in Node; in a browser the
   * WASM thread count is global and set by the engine).
   */
  static async load(): Promise<SileroVad> {
    const model = await PreTrainedModel.from_pretrained(VAD_MODEL, {
      config: { model_type: "custom" } as never,
      dtype: "fp32",
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
    });
    return new SileroVad(model as SileroModel);
  }

  /** Speech probability of each 512-sample frame of 16 kHz audio (a partial last frame is padded with zeros). */
  async probabilities(samples: Float32Array): Promise<Float32Array> {
    const frames = Math.ceil(samples.length / VAD_FRAME);
    const result = new Float32Array(frames);
    const sr = new Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
    let state = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    for (let f = 0; f < frames; f++) {
      const at = f * VAD_FRAME;
      const window = new Float32Array(CONTEXT + VAD_FRAME);
      if (at >= CONTEXT) window.set(samples.subarray(at - CONTEXT, at));
      window.set(samples.subarray(at, at + VAD_FRAME), CONTEXT);
      const input = new Tensor("float32", window, [1, CONTEXT + VAD_FRAME]);
      const { output, stateN } = await this.model({ input, sr, state });
      result[f] = (output.data as Float32Array)[0] ?? 0;
      state = stateN;
    }
    return result;
  }
}
