The web app in the current directory needs UI changes. A user described them; their request is between the markers below. Do not change any file: only find where each change goes.

Identify every change the user asks for, searching the code as much as you need. Then reply with JSON only, matching the given schema:

- `changes`: one entry per requested change; if a change needs edits in several places, one entry per place.
  - `request`: the change, in a few words.
  - `file`: path of the file to edit, relative to the current directory.
  - `line`: line number of the target in that file (0 if none).
  - `target`: the exact code construct to edit: a CSS selector, an element id, a component, or the element with its distinguishing text.
  - `confidence`: from 0 to 1, how sure you are that this is what the user meant.

<request>
{{REQUEST}}
</request>
