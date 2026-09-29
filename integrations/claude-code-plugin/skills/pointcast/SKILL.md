---
name: pointcast
description: Apply a pointcast recording (what the user said while pointing at elements of their web app) as code changes in this project. Use when the user asks to apply, implement or read a pointcast recording or session, or to listen or watch for their recordings.
argument-hint: "[session-id | watch] [precise]"
allowed-tools: mcp__plugin_pointcast_recordings__list_sessions mcp__plugin_pointcast_recordings__get_session mcp__plugin_pointcast_recordings__get_element mcp__plugin_pointcast_recordings__wait_for_recording
---

Apply a pointcast recording to this project.

If the user wrote `precise` after the command (`/pointcast precise`, also with a session id or `watch`), pass `style: "precise"` to every `get_session` and `wait_for_recording` call: the spec then tells you to change only the elements pointed at, and only as asked. Otherwise pass no `style`, and the spec says what the user chose when recording.

If the user wrote `watch` after the command, or asks you to listen or watch for recordings, use watch mode below. Otherwise:

1. Call the pointcast `get_session` tool with `id` set to the session id the user gave, or to `"latest-here"` (the newest recording made on this project) if they gave none. If you are unsure which recording the user means, call `list_sessions` first (it shows each recording's pages, a preview of its first request and whether it matches this project) and ask.
2. If the result starts with a **Warning** that the recording seems to be from another project, stop and tell the user. Do not edit anything until they confirm the project, or give you its folder to pass as `repo`.
3. Follow the spec's own rules, written at its top: they come first. Each request quotes what the user said (speech-to-text, so words may be misheard) and lists the elements they pointed at while saying it.
4. Find each element through its code pointer before searching:
   - `text at:` or `data at:` is the line that holds that element's text or data: usually the line to change.
   - `class at:` or `id at:` is, for an element with no text of its own (a container, a map layer), the line where its own tag is written with that class or id.
   - `shown by:` is the line that displays that value (`<td>{order.customer}</td>`): change it instead when the request is about how the value is shown, not what it is.
   - `code:` is where that instance is written, innermost first. The first frame may be a shared component that renders every instance; change the instance, not the shared component, unless the request is about all of them.
   - Search the codebase only when the spec gives no pointer, and then use its `find:` hints.
5. If a request is ambiguous, ask before editing it. Apply each request as the spec's rules at its top say, and do nothing the user did not ask for.
6. When you are done, list each request with the `file:line` you changed, and any request you skipped and why.

Watch mode: keep applying the user's recordings as they make them, until they tell you to stop.

1. Tell the user in one line that you are listening, and that they can record in the browser now.
2. Call `wait_for_recording`. It only returns recordings made on this project: one whose source files are all missing here is left for an agent working on that project. If it answers "No new recording yet", call it again right away, without writing anything to the user. Pass `anyProject: true` only when the user asks for recordings from any project.
3. When it returns a recording, apply it with steps 2 to 5 above. The same rules hold: if it starts with the other-project **Warning** (only possible with `anyProject`), do not edit; tell the user and ask whether to apply it here or keep listening. A recording that names no source files cannot be checked against the project: if its pages do not look like this project's app, ask before editing. If a request is ambiguous, ask, and wait for the answer before going on.
4. Before listening again, always report to the user: one line per request with the `file:line` you changed, or why you skipped it. Never go back to waiting without this report.
5. Go back to step 2. Stop when the user says so.

`get_element` returns everything recorded about one pointed element (HTML, styles, selector, component chain). Event ids are `e1`, `e2`… in the order the user pointed.
