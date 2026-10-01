# LinkedIn posts

Two versions of one post: Spanish first (your network), English second (post it as a separate post a day or two later, or skip it). The angle is the build-and-measure story, for your career: a problem, how it was evaluated, what the evaluation taught, and the result.

How to post:

- **Upload the video natively** (`docs/launch/video/out/pointcast-demo.mp4`, no sound; LinkedIn plays it muted and inline), or the short hero GIF (`pointcast-hero.gif`). A link in the post body lowers its reach, so the links go in the **first comment**, posted right away by you.
- No more than 3–5 hashtags, at the end.
- Never name or show a colleague's or a private app. Thank people by name only if they agreed.

---

## Español

Programando con IA me pasaba el día escribiendo cosas como "el botón de la derecha… no, el otro, el de la tarjeta de abajo". El agente no ve qué es "esto", y una captura le da píxeles, no el archivo.

Así que construí Pointcast: una extensión de Chrome en la que hablas (o escribes una nota) mientras haces Alt+clic en los elementos de tu web. Al parar, cada frase es una petición y cada elemento llega a tu agente (Claude Code, Codex, Gemini CLI o Cursor) con la línea de código que hay detrás. Con el modo escucha, el agente recoge cada grabación nada más pulsar Stop: tú sigues revisando tu app y él va aplicando los cambios. La voz se transcribe en tu ordenador; no sale nada.

Lo que más he aprendido ha sido medirlo:

• Diez cambios en una app real de React. Escribirlos en un prompt cuidado me llevó 15–20 minutos; grabarlos con Pointcast, minuto y medio. En una revisión a ciegas de los resultados, el de la grabación sacó 192 de 200 y el del prompt escrito, 174. Es una sola ejecución de cada uno y la revisión la hizo un modelo de IA: lo leo como una dirección, no como un margen exacto.

• Ese mismo experimento destapó un fallo mío: las instrucciones que Pointcast le daba al agente decían "cambia solo lo que se señala". Con esa frase, la misma grabación sacó 146: el agente hacía lo mínimo en todo lo nuevo. Ahora le dice que los elementos marcan dónde, y que lo nuevo lo construya bien con el estilo de la app.

• Una regla de diseño que ha pesado mucho: si no está seguro, no dice nada. Una línea que falta le cuesta al agente una búsqueda; una equivocada, un cambio en el sitio equivocado.

• Funciona con React (también Next.js), Vue, Svelte y plantillas de Django, y ya tiene dos colaboradores externos.

Es código abierto (MIT) y gratis, ya en la Chrome Web Store. Si programas webs con IA, me encantaría saber dónde falla en tu proyecto.

Enlaces en el primer comentario

#OpenSource #DesarrolloWeb #IA #ClaudeCode #DeveloperTools

**Primer comentario:**

```
Repositorio, vídeo y evaluaciones: https://github.com/Hugelidus/pointcast
Chrome Web Store: https://chromewebstore.google.com/detail/pointcast/hliijcklkpbddgjhkifjeggidghbbboa
```

---

## English

Coding with AI, I spent my days typing things like "the button on the right… no, the other one, in the card below". The agent can't see what "this" is, and a screenshot gives it pixels, not the file.

So I built Pointcast: a Chrome extension where you talk (or type a note) while you Alt+click the elements of your web app. At Stop, each sentence becomes a request and each element reaches your agent (Claude Code, Codex, Gemini CLI or Cursor) with the line of code behind it. In watch mode the agent picks up each recording the moment you press Stop: you keep reviewing your app, it keeps applying the changes. Your voice is transcribed on your machine; nothing leaves it.

What taught me the most was measuring it:

• Ten changes on a real React app. Writing them as one careful prompt took me 15–20 minutes; recording them with Pointcast, a minute and a half. In a blind review of the results, the recording scored 192/200 and the hand-written prompt 174. One run of each, reviewed by an AI model: I read it as a direction, not an exact margin.

• The same experiment exposed a mistake of mine: Pointcast's instructions told the agent "change only what was pointed at". With that line, the same recording scored 146: the agent did the minimum on anything new. Now it says the elements mark where, and new things should be built properly in the app's style.

• The design rule that mattered most: when it isn't sure, it says nothing. A missing line costs the agent a search; a wrong one costs an edit in the wrong place.

• It works with React (Next.js too), Vue, Svelte and Django templates, and it already has two outside contributors.

Open source (MIT), free, now on the Chrome Web Store. If you build web apps with AI, I'd love to hear where it breaks on your project.

Links in the first comment

#OpenSource #WebDevelopment #AI #ClaudeCode #DeveloperTools

**First comment:**

```
Repository, video and evaluations: https://github.com/Hugelidus/pointcast
Chrome Web Store: https://chromewebstore.google.com/detail/pointcast/hliijcklkpbddgjhkifjeggidghbbboa
```
