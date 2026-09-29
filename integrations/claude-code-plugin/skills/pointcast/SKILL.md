---
name: pointcast
description: Apply a pointcast recording (what the user said while pointing at elements of their web app) as code changes in this project. Use when the user asks to apply, implement or read a pointcast recording or session.
argument-hint: "[session-id]"
allowed-tools: mcp__plugin_pointcast_pointcast__list_sessions mcp__plugin_pointcast_pointcast__get_session mcp__plugin_pointcast_pointcast__get_element
---

Apply a pointcast recording to this project.

1. Call the pointcast `get_session` tool with `id` set to the session id the user gave, or to `"latest-here"` (the newest recording made on this project) if they gave none. If you are unsure which recording the user means, call `list_sessions` first (it shows each recording's pages, a preview of its first request and whether it matches this project) and ask.
2. If the result starts with a **Warning** that the recording seems to be from another project, stop and tell the user. Do not edit anything until they confirm the project, or give you its folder to pass as `repo`.
3. Follow the spec's own rules, written at its top: they come first. Each request quotes what the user said (speech-to-text, so words may be misheard) and lists the elements they pointed at while saying it.
4. Find each element through its code pointer before searching:
   - `text at:` or `data at:` is the line that holds that element's text or data: usually the line to change.
   - `class at:` or `id at:` is, for an element with no text of its own (a container, a map layer), the line where its own tag is written with that class or id.
   - `shown by:` is the line that displays that value (`<td>{order.customer}</td>`): change it instead when the request is about how the value is shown, not what it is.
   - `code:` is where that instance is written, innermost first. The first frame may be a shared component that renders every instance; change the instance, not the shared component, unless the request is about all of them.
   - Search the codebase only when the spec gives no pointer, and then use its `find:` hints.
5. If a request is ambiguous, ask before editing it. Change only what was asked.
6. When you are done, list each request with the `file:line` you changed, and any request you skipped and why.

`get_element` returns everything recorded about one pointed element (HTML, styles, selector, component chain). Event ids are `e1`, `e2`… in the order the user pointed.
