import { listenFor } from "../../messages";
import { Recorder } from "../../offscreen/recorder";
import { runProcessing, startLiveTranscription } from "../../offscreen/run-processing";

const recorder = new Recorder((job) => {
  runProcessing(job).catch((error: unknown) => console.error("[pointcast] processing failed", error));
}, startLiveTranscription);
listenFor("offscreen", (message) => recorder.handle(message));
