# LinkedIn posts

Two versions of one post: Spanish first (your network), English second (post it as a separate post a day or two later, or skip it). The angle is the build-and-measure story, for your career: a problem, how it was evaluated, what the evaluation taught, and the result.

How to post:

- **Upload the video natively** (`docs/launch/video/out/pointcast-demo.mp4`, ~27.5 s, no sound; LinkedIn plays it muted and inline). The short hero GIF (`pointcast-hero.gif`, 9.6 s) works too if you'd rather keep it snappy. A link in the post body lowers its reach, so the repository link goes in the **first comment**, posted right away by you. The post says so in its last line.
- No more than 3–5 hashtags, at the end.
- Tag nobody who hasn't agreed to it. The colleague who tested it can be thanked by name only if they're happy with that; the app itself is never named.

---

## Español

Trabajando con agentes de programación, me encontraba siempre con el mismo problema: le escribes "haz que esto se pueda ordenar y pon esto al lado de aquello", y el agente no sabe qué es "esto". Así que acabas escribiendo un segundo mensaje explicándolo.

Construí Pointcast para resolverlo: una extensión de Chrome y Edge en la que hablas (o escribes una nota, si no puedes hablar) mientras haces Alt+clic en los elementos de tu aplicación. Al parar, cada frase se convierte en una petición, y cada elemento señalado llega al agente (Claude Code, Codex, Gemini CLI o Cursor) con la línea de código que hay detrás — no el HTML, la línea que lo genera. La voz se transcribe en el propio navegador; nada sale del ordenador.

Lo que más he aprendido no ha sido construirlo, sino medirlo:

• Antes de publicar nada, monté una evaluación sobre tres dashboards reales de código abierto (React, Vue y Svelte): la misma petición hablada, con y sin señalar. Señalando, el agente acertó el elemento el 89 % de las veces, frente al 78 % sin señalar.

• La evaluación también dijo lo que no quería oír: una descripción escrita con cuidado seguía ganando (96 %), y señalar no ahorraba tokens. Lo publiqué igual.

• Ese resultado marcó el siguiente paso: darle al agente el archivo y la línea exactos. Con eso, los tokens que gastaba en encontrar los elementos bajaron a menos de la mitad.

• Un compañero lo probó en su proyecto Django real y ahí no llegaba al código: las plantillas del servidor no dicen de dónde viene cada elemento. Un paquete para Django lo resuelve, marcando las plantillas solo en desarrollo. En una app Django + HTMX de unas 1.300 plantillas, colocó ~94 % de los elementos de muestra en su línea exacta, y ninguno en una línea equivocada.

• Una grabación real trae varios cambios a la vez, no uno. Repetí la comparación con seis cambios en una sola grabación: el agente acertó el código el 96 % de las veces frente al 85 % del mismo pedido escrito a mano, con un 24 % menos de tokens y un 75 % menos de búsquedas. Pedir un cambio cada vez sigue siendo algo más preciso, pero no más barato: el ahorro está en agruparlos.

• Desde entonces añadí lo que pedían los primeros usuarios: un modo escrito para cuando no se puede hablar, y que la grabación recoja los errores de consola y de red de los segundos alrededor de cada elemento señalado, para que el agente sepa no solo qué botón sino por qué no hacía nada.

• La regla que más ha pesado en el diseño: si no está seguro, no dice nada. Una línea que falta le cuesta al agente una búsqueda; una línea equivocada le cuesta un cambio en el sitio equivocado.

Es código abierto (MIT), está en beta pública y los informes de evaluación, con sus límites, están en el repositorio. Si trabajas con agentes en interfaces web, me encantaría saber dónde falla en tu proyecto.

Enlace al repositorio en el primer comentario

#OpenSource #DesarrolloWeb #IA #Django #DeveloperTools

**Primer comentario:**

```
Repositorio, vídeo e informes de evaluación: https://github.com/Hugelidus/pointcast
```

---

## English

Working with coding agents, I kept running into the same problem: you type "make this sortable and put this next to that", and the agent has no idea what "this" is. So you write a second message explaining it.

I built Pointcast to fix that: a Chrome and Edge extension where you talk (or type a note, if you can't) while you Alt+click the elements of your app. At Stop, each sentence becomes a request, and each element you pointed at reaches the agent (Claude Code, Codex, Gemini CLI or Cursor) with the line of code behind it — not the HTML, the line that makes it. Your voice is transcribed in the browser; nothing leaves your machine.

What taught me the most wasn't building it, it was measuring it:

• Before publishing anything, I ran an evaluation on three real open-source dashboards (React, Vue and Svelte): the same spoken request, with and without pointing. With pointing, the agent picked the right element 89% of the time, against 78% without.

• The evaluation also told me what I didn't want to hear: a carefully written description still won (96%), and pointing saved no tokens. I published that too.

• That result set the next step: give the agent the exact file and line. With it, the tokens the agent spent finding the elements fell by more than half.

• A colleague tried it on their real Django project, and there it couldn't reach the code: server templates don't say where each element comes from. A small Django package fixes that, marking templates in development only. On a Django + HTMX app with about 1,300 templates, it placed ~94% of sampled elements on their exact line, and none on a wrong one.

• A real recording usually carries several changes, not one. I re-ran the comparison with six changes in a single recording: the agent got the right code 96% of the time against 85% for the same six changes typed by hand, at 24% fewer tokens and 75% fewer searches. Asking one change at a time stayed a bit more accurate, but not cheaper: the saving is in batching them.

• Since then I've added what early users asked for: a typed mode for when talking isn't an option, and a setting that carries the console and network errors around each pointed element, so the agent knows not just which button but why it did nothing.

• The rule that shaped the design most: when it isn't sure, it says nothing. A missing line costs the agent a search; a wrong line costs an edit in the wrong place.

It's open source (MIT), in public beta, and the evaluation reports, limits included, are in the repository. If you use agents on web UIs, I'd love to hear where it breaks on your project.

Repository link in the first comment

#OpenSource #WebDevelopment #AI #Django #DeveloperTools

**First comment:**

```
Repository, video and evaluation reports: https://github.com/Hugelidus/pointcast
```
