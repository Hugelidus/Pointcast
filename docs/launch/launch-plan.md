# Plan de lanzamiento (0.3)

Para Hugo. Los textos están en esta carpeta; aquí va solo qué hacer, en qué orden y cuándo. Nada de esto está publicado: todo lo publicas tú.

## 1. Antes del lanzamiento (checklist)

- [ ] **Chrome Web Store aprobada.** Sin ella, cada post dice "carga el zip a mano", y eso frena a la mitad de la gente. Cuando la aprueben: subir el zip de tienda de 0.3.0 (el artefacto `pointcast-0.3.0-chrome-store` del workflow de release, nunca el zip de la release), comprobar que se instala desde la ficha y cambiar el paso 1 del README ("in review") por el enlace a la ficha. Si la aprobación tarda más de ~2 semanas, lanzar igual con el zip y decirlo en los posts.
- [ ] **Edge Add-ons enviada** ([edge-addons.md](edge-addons.md)). No bloquea el lanzamiento; al publicarse, añadir su id a `OFFICIAL_EXTENSION_IDS` en la siguiente release del CLI.
- [ ] **Vídeo en `main`.** El vídeo de 18 s con «View report» y «Export» está en la rama `video-export`: hacer merge (PR) antes del lanzamiento, porque todos los posts enlazan a `blob/main/docs/launch/video/out/pointcast-demo.mp4`. Detalle: el `alt` del GIF en el README dice "17 seconds"; ahora dura ~18.
- [ ] **Segunda prueba del compañero** con 0.3 y `pointcast-django` en su app real: que grabe 3–5 peticiones, aplique con su agente y te diga qué señaló mal. Si sale algo grave, arreglarlo antes; si no, sus palabras (con su permiso) valen más que cualquier número. Nunca nombrar su app en público.
- [ ] **Social preview.** GitHub ya tiene una imagen personalizada (`docs/launch/store/social-preview.png`). Dice "Chrome extension": valorar regenerarla con "Chrome & Edge" (`node docs/launch/store/render.mjs`) y volver a subirla en *Settings → Social preview*. Comprobar cómo se ve pegando el enlace del repo en X y LinkedIn (vista previa).
- [ ] **Pins.** Fijar el repo en tu perfil de GitHub; abrir una Discussion "Launch feedback" (Announcements) y fijarla; el día del lanzamiento, fijar el hilo de X/Bluesky en tu perfil.
- [ ] **README al día.** El Quick start todavía dice `npx -y pointcast@0.2 mcp`: pasarlo a `@0.3`. Revisar que los enlaces de los informes funcionan desde `main`.
- [ ] **Temas del repo.** Añadir `django` y `htmx` a los topics (ahora no están).
- [ ] **Issues para recién llegados.** Ya hay `good first issue`/`help wanted` (#3–#9); revisar que siguen vigentes y cerrar o agrupar los PR de dependabot (#11, #12, #17) para que el repo se vea cuidado.
- [ ] **Cuentas listas:** HN (una cuenta con algo de historial ayuda), Reddit (karma mínimo en algunos subs), X, Bluesky, LinkedIn, dev.to.

## 2. Orden y calendario

**Semana previa: directorios** (tardan días en revisar y no dependen del día de lanzamiento). Pasos exactos en [listings.md](listings.md):

1. Verificar la galería de extensiones de Gemini CLI (automática).
2. Enviar a awesome-mcp-servers (PR con una línea).
3. MCP Registry: requiere una release del CLI con `mcpName` (0.3.1); hacerlo cuando salga esa release, antes o después del lanzamiento, da igual.
4. Directorio de plugins de Claude: ya enviado; comprobar el estado. Marketplace de la comunidad: ver la nota en listings.md antes de enviar otra vez.
5. PyPI para `pointcast-django`: publicarlo antes del lanzamiento, así el post de r/django dice `pip install pointcast-django`.

**Día de lanzamiento: martes, miércoles o jueves, ~16:00 hora de España** (10:00 en Nueva York, 7:00 en California: la mañana de EE. UU., cuando HN y Reddit tienen más tráfico). Evitar lunes, viernes y festivos de EE. UU.

| Hora (España) | Dónde | Texto |
|---|---|---|
| 16:00 | Show HN (enlace al repo + primer comentario inmediato) | [show-hn.md](show-hn.md) |
| 16:15 | Hilo de X y Bluesky, con el vídeo; fijarlo | [social-thread.md](social-thread.md) |
| 16:30 | r/ClaudeAI | [reddit.md](reddit.md) |
| 17:00 | LinkedIn en español (enlace en el primer comentario) | [linkedin.md](linkedin.md) |
| día +1 | r/ChatGPTCoding | [reddit.md](reddit.md) |
| día +2 | r/django (con `pip install pointcast-django` si ya está en PyPI) | [reddit.md](reddit.md) |
| día +2 o +3 | LinkedIn en inglés (opcional) | [linkedin.md](linkedin.md) |
| primer sábado | r/webdev, solo en *Showoff Saturday* | [reddit.md](reddit.md) |
| ~1 semana después | Artículo en dev.to (y Medium con URL canónica) | [technical-article-outline.md](technical-article-outline.md) |
| ≥ 11 de octubre y con usuarios | awesome-claude-code (formulario web) | [listings.md](listings.md) |

Reglas: un mismo texto nunca en dos sitios el mismo día; no pedir votos a nadie (HN penaliza los anillos de votos y puede enterrar el post); si Show HN no despega en ~2 h, no volver a enviarlo: se puede intentar otra vez semanas después con una novedad real.

## 3. Estar disponible 24 h

- **Bloquear las 24 h siguientes al post de HN.** Las primeras 2–3 h deciden si sube a portada; contestar cada comentario en minutos, con datos y enlaces a los informes, sin discutir. Reconocer los límites antes de que te los señalen.
- **Tener abiertos:** HN, los hilos de Reddit, las notificaciones de X/Bluesky/LinkedIn, las issues y Discussions del repo.
- **Bugs que lleguen ese día:** reproducir, abrir issue, responder con el enlace; arreglar en una 0.3.x solo si bloquea la instalación. Mejor una respuesta rápida y honesta que un parche con prisa.
- **Preguntas previsibles** y sus respuestas: al final de [show-hn.md](show-hn.md).
- **Después:** apuntar en una issue o Discussion lo que se repitió (fallos, frameworks pedidos). Eso decide la 0.4 y da material al artículo.
