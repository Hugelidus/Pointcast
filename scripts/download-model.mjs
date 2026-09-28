/**
 * Downloads Xenova/whisper-base and the Silero VAD (packages/transcribe/src/vad.ts) once into
 * transformers.js' own cache in node_modules: the cache the CLI reads, and the folder the e2e
 * suite serves to the extension (playwright.config.ts). Does nothing but load the models when
 * they are already there.
 *
 *   node scripts/download-model.mjs
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolved like @pointcast/transcribe resolves it: the repository root does not depend on it.
const fromTranscribe = createRequire(new URL("../packages/transcribe/package.json", import.meta.url));
const transformers = await import(pathToFileURL(fromTranscribe.resolve("@huggingface/transformers")).href);
const { pipeline, AutoModel, env } = transformers.pipeline ? transformers : transformers.default;

const asr = await pipeline("automatic-speech-recognition", "Xenova/whisper-base", { dtype: "fp32" });
await asr.dispose();
console.log(`Xenova/whisper-base is in ${env.cacheDir}`);

// Loaded as vad.ts loads it (the repo has no config.json, so the model type is given).
const vad = await AutoModel.from_pretrained("onnx-community/silero-vad", { config: { model_type: "custom" }, dtype: "fp32" });
await vad.dispose();
console.log(`onnx-community/silero-vad is in ${env.cacheDir}`);
