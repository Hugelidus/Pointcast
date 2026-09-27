# LinkedIn posts (CV angle: shipped an open-source dev tool end to end — problem framing, evaluation methodology, MV3/browser-ML engineering)

Placeholders: `<GitHub link>`, `<your name>` — fill in before posting. Adjust "I" claims if this becomes a joint/team post.

---

## English

Over the last few weeks I designed, built and evaluated **pointcast**, an open-source Chrome extension that lets you narrate UI changes to an AI coding agent while pointing at the exact elements you mean — instead of typing "this button" and hoping the agent guesses right.

What made this an interesting build, beyond the product idea:

- **I didn't assume it worked — I measured it.** Before writing any launch copy, I ran a controlled evaluation across three real open-source codebases (React, Vue and Svelte admin dashboards), comparing a coding agent's accuracy at identifying the right UI element with vs. without the pointing data. Result: 78% → 89% accuracy, concentrated exactly where ambiguity is highest (duplicate buttons, shared components). I also measured where a plain hand-written description still wins (96%, fewer tokens) — an honest evaluation reports what *doesn't* favor your own tool, too.
- **Local machine-learning in the browser, in production constraints.** Getting Whisper (via transformers.js/ONNX) to run inside a Chrome MV3 extension's offscreen document — with no server, no API key, audio never leaving the device — meant solving real constraints: WASM compilation under MV3's content-security policy, cross-origin isolation for multi-threading, serving model runtime files from the extension itself instead of a CDN (which MV3 forbids). Fully documented with the numbers behind every default: 43 s to transcribe 152 s of speech, 92.8% word accuracy, and why WebGPU was *not* the answer on this hardware.
- **A real algorithmic core.** Fusing a spoken transcript with pointing gestures separated in time is a sequence-alignment problem — solved with dynamic programming (closer in spirit to `diff` than to nearest-neighbor matching), because greedy matching provably picks the wrong pairing in common cases.
- **Every non-obvious decision is documented**, including what was rejected and why — the kind of design log I'd want from anyone I hand a codebase to.

It's MIT licensed and Phase 1 of a longer roadmap (source-location mapping, broader framework support next). If you build with AI coding agents and this problem is familiar, I'd love feedback.

<GitHub link>

---

## Español

En las últimas semanas diseñé, construí y evalué **pointcast**, una extensión de Chrome de código abierto que permite narrar cambios de interfaz a un agente de IA mientras señalas exactamente el elemento del que hablas — en vez de escribir "este botón" y confiar en que el agente adivine bien.

Lo que hizo de este proyecto algo interesante más allá de la idea de producto:

- **No asumí que funcionaba: lo medí.** Antes de escribir cualquier texto de lanzamiento, ejecuté una evaluación controlada sobre tres proyectos reales de código abierto (dashboards en React, Vue y Svelte), comparando la precisión de un agente de codificación al identificar el elemento correcto, con y sin los datos de señalización. Resultado: 78% → 89% de precisión, concentrado justo donde la ambigüedad es mayor (botones duplicados, componentes compartidos). También medí dónde una descripción escrita a mano sigue ganando (96%, menos tokens) — una evaluación honesta también reporta lo que no favorece a tu propia herramienta.
- **Machine learning local en el navegador, con restricciones de producción.** Conseguir que Whisper (vía transformers.js/ONNX) corra dentro de un documento offscreen de una extensión Chrome MV3 — sin servidor, sin API key, sin que el audio salga nunca del dispositivo — implicó resolver restricciones reales: compilación de WASM bajo la política de seguridad de contenido de MV3, aislamiento de origen cruzado para multihilo, y servir los archivos del runtime del modelo desde la propia extensión en vez de un CDN (que MV3 prohíbe). Todo documentado con los números detrás de cada decisión: 43 s para transcribir 152 s de audio, 92.8% de precisión por palabra, y por qué WebGPU no fue la respuesta en este hardware.
- **Un núcleo algorítmico real.** Fusionar una transcripción hablada con gestos de señalización separados en el tiempo es un problema de alineación de secuencias — resuelto con programación dinámica (más parecido a `diff` que a un simple vecino más cercano), porque el emparejamiento voraz falla de forma demostrable en casos comunes.
- **Cada decisión no evidente está documentada**, incluyendo qué se descartó y por qué — el tipo de registro de diseño que a mí me gustaría recibir al heredar un código.

Es de licencia MIT y es la Fase 1 de una hoja de ruta más larga (mapeo de ubicación de código fuente, más frameworks). Si trabajas con agentes de codificación con IA y este problema te suena familiar, me encantaría recibir feedback.

<enlace a GitHub>
