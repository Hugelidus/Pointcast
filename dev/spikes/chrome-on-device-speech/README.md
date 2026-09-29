# Spike: Chrome's on-device Web Speech API for Pointcast (es-ES)

Throwaway research, 2026-09-29. The question: can `SpeechRecognition` with `processLocally: true` replace or
complement local Whisper? Machine: i9-12900K, Windows 11, **Google Chrome 154.0.8037.58** (installed, not
Playwright's Chromium). Every number below comes from the scripts and logs in this folder.

**Verdict: complement it, as an "Instant" option. Do not replace Whisper yet.** On the 152 s Spanish fixture it is
more accurate than whisper-base (95.5–96.6 % vs 92.8 %). Text is ready about 50 ms after `stop()`, where Whisper
needs about 2.9 s after Stop. It works in an MV3 offscreen document, fed with a `MediaStreamTrack`, and it makes no
network requests. It has three weaknesses. It gives no word times, so they have to be estimated. Its output has no
punctuation or casing. And it depends on a 388 MB Chrome download that we do not control (see Blockers).

## Evidence

| | Chrome on-device (this spike) | whisper-base, browser (D1 / in-browser-whisper) |
|---|---|---|
| Chrome version | 154 (`SpeechRecognition.available/install`, `processLocally`, `start(track)`, plus `phrases`, `quality`, `unspokenPunctuation`) | any |
| `available({langs:["es-ES"],processLocally:true})` | `downloadable` → `available` after `install()` | n/a |
| Download | SODA 40 MB + es-ES 154 MB + **en-US 194 MB (required, see below)** = 388 MB, about 6–12 s | 291 MB |
| Normal page | yes | yes |
| MV3 offscreen document (USER_MEDIA + AUDIO_PLAYBACK) | yes | yes |
| `start(mediaStreamTrack)` | yes (getUserMedia track and WebAudio track) | n/a (WAV) |
| Word accuracy, es-2min (290 words) | **96.6 %** (WebAudio track), **95.5 %** (fake-mic getUserMedia track, offscreen) | 92.8 % |
| Word accuracy, es-short (16 words) | 100 % (every run) | 93.8 % |
| Word times | **none**; estimated from when each word first shows up in the interim results | native |
| Word-start error, es-2min, self-calibrated lag | median 61–75 ms, p90 169–260 ms, 91–99.6 % within 300 ms | 165 / 265 ms |
| Word-start error, es-2min, lag fixed at 580 ms (from es-short) | median 83–98 ms, p90 204–274 ms, 91–100 % within 300 ms | 165 / 265 ms |
| Lag from word start to first appearance | median 512–526 ms (es-2min), 572–594 ms (es-short), p10–p90 about 380–790 ms | n/a |
| End of speech → final result (endpointer, 20 phrases) | median about 760 ms, p90 800–850 ms | n/a |
| `stop()` → last final | **52 ms** (flushes the pending phrase) | 2.9 s Stop → Markdown |
| Punctuation / casing | none / lowercase (only "Estado" was capitalized) | yes |
| Long recording (152 s) | 1 session, 20 finals, no restarts needed | chunks |
| Silence | 108 s of silence after speech: session stays open, no invented text, no auto-stop | needs VAD + sanitizer |
| CPU | speech utility process about 56–61 CPU-s per 165 s ≈ **0.35 core while recording**, plus the audio service at 0.5–4 s | 43 s wall on 4 threads **after** Stop |
| Network with `processLocally:true` | no speech endpoint in the net log. It still recognizes with DNS for every non-localhost host mapped to NOTFOUND | none after download |

Errors on es-2min are mostly UI vocabulary: "ordenable" → "orden a bala", "botón" → "votown/bowtone", "debounce" →
"devounce", "aquí al lado" → "a q y al lado". `phrases` (contextual biasing, in the prototype) could fix these,
much as the element-text prompt was meant to do for Whisper. It is untested.

### Word timing: how and how reliable

Results carry no times, and `SpeechRecognitionAlternative` has only `transcript` and `confidence` (always 1). Interim
results arrive every 100–250 ms and grow about one word at a time. Words are often partial, as in "estuvi" →
"estuviera" or "FIL" → "filtra" → "filtrado". So `analyze.mjs` estimates times by slot. For the k-th word of a
final result, it takes the arrival time of the first event in which that result already had more than k words,
then subtracts a constant lag. With the lag fitted per recording, starts land within Pointcast's ~300 ms bar
(p90 ≤ 260 ms). But the lag moved between recordings (512–594 ms median), and each word's lag spread by about
±200 ms. Real-time arrival also depends on CPU load, which was never tested under contention. In a product, the lag
would have to be re-anchored, for example by fitting each phrase's first word to the VAD speech onset in the WAV we
record anyway. That is plausible but unproven. `event.timeStamp` equals arrival time and adds nothing.

## Blockers and gotchas (the important part)

1. **es-ES alone does not work in Chrome 154: en-US must be installed too.** On two fresh profiles with only
   es-ES installed, `available()` said `available`, but every `start()` failed at once with `error: "aborted"`.
   Chrome's log said `chrome_speech_recognition_service.cc:300 Unable to find SODA files on the device`.
   `install({langs:["en-US"]})` (+194 MB) fixed it right away. This looks like a Chrome bug or an undocumented
   dependency, so Pointcast would have to install both packs.
2. **`install()` needs a user gesture when the state is `downloadable`.** A normal page without activation got
   `NotAllowedError: Requires handling a user gesture when availability is "downloadable"`. In tests, Playwright's
   `evaluate()` and `click()` carry a gesture, so an automated install works (6–12 s, no prompt). In the offscreen
   document, `navigator.userActivation.isActive` was `true` and `install()` succeeded without a gesture. But the
   state there was already `downloading` (Chrome had started the download itself), so this does not prove offscreen
   installs are allowed. **Decision for Hugo:** call `install({langs:["es-ES","en-US"]})` from the popup or side-panel
   click (Record or a Settings toggle). That is safe either way.
3. **Chrome manages the packs, not us.** `Local State` holds `soda_*_scheduled_deletion_time`, so Chrome deletes
   packs it considers unused, and the version is Chrome's choice. The feature has to be detected every time
   (`available()`), with Whisper as the fallback. It is Chrome-only (not Edge) and desktop-only.
4. **Test harness: Playwright's `launchPersistentContext` breaks it.** Launched that way, with Playwright's default
   switches or with `ignoreDefaultArgs` for the suspicious ones, recognition ran but never produced a result
   (headless and headed). The same Chrome gave results when started as a plain `chrome.exe` and driven with
   `chromium.connectOverCDP`, even with every Playwright default switch added by hand. So the cause is how Playwright
   launches Chrome, not its switches. The cause was not found within the time budget. The scripts use `--raw`
   (spawn + CDP), and extensions load with `Extensions.loadUnpacked` (`--enable-unsafe-extension-debugging`),
   because branded Chrome ignores `--load-extension`.
5. **Default-mic `start()` cannot be tested with a fake mic.** With `--use-file-for-fake-audio-capture`,
   `start()` (no track) gave nonsense ("seguro que has visto", "…mi prima Edgar Álvaro…") or nothing. The same fake
   device through `getUserMedia` → `start(track)` was transcribed perfectly. Pointcast would pass the track it
   already captures, so this does not block it. A real mic was not tested (no sound allowed).

## What an "Instant" mode would look like

In the offscreen recorder, `new SpeechRecognition()` would run with `lang`, `continuous`, `interimResults` and
`processLocally`, fed by `start(track)` on the mic track we already record. Finals would be collected, with word
starts taken from interim arrivals and re-anchored to VAD onsets. On Stop, `stop()` makes the transcript final within
about 50 ms. The WAV would still be kept, so Whisper can re-transcribe it as "Accurate" (punctuation, native times)
when the user wants that, or whenever Chrome's pack is not available.

## Files

- `lib.mjs`: Playwright from the main checkout's `node_modules`, a localhost server, fake-mic switches, low priority.
- `probe.js`: `probe.api()`, `probe.install()`, `probe.recognize({source: "mic" | "track" | "file:<wav>"})`, an event log
  with arrival times and a level-onset marker used to align times with the file.
- `ext/`: a throwaway MV3 extension. The page gives the gesture and the offscreen document (USER_MEDIA +
  AUDIO_PLAYBACK) recognizes.
- `run.mjs`: one run. For example: `node run.mjs --raw --where offscreen --source file:es-2min.wav --wav es-2min.wav
  --until 165000 [--offline] [--netlog] [--install-langs es-ES,en-US]`.
- `analyze.mjs`: accuracy (same scoring as `dev/scripts/bench`, via `../in-browser-whisper/score.mjs`), estimated
  word starts, lag, end-of-speech → final, CPU. `netlog-urls.mjs` lists the URLs in the net log.
- `step1-api.mjs`, `poll-available.mjs`: API surface, `available()` / `install()` behaviour, and install without a
  gesture. `check-fake-mic.mjs`: the level of the fake mic.
- `results/`: raw event logs, `summary.json` (the table above) and run transcripts. `page-mic-*` are the failed
  default-mic runs (gotcha 5). The `*-cloud` runs are `processLocally:false` controls. With `--offline` they also
  recognized, so Chrome ran them locally too. One online `page-mic` cloud run may have sent the public fixture audio
  to Google.

Profiles live in `%TEMP%\pc-speech-*` (each holds the 388 MB of packs) and can be deleted.
