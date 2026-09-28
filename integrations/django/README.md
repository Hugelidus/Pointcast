# pointcast-django

Point at an element of a Django page while recording with [pointcast](https://github.com/Hugelidus/pointcast), and the spec your agent gets says which **template** rendered it, and the line its text is written on:

```text
- [a] «Archivar» → code:
  - template: `templates/pim/partials/row.html`
  - text at: `templates/pim/partials/row.html:5` — `<td><button hx-post="/pim/{{ product.sku }}/archive/" …>Archivar</button></td>`
  - within: template `templates/pim/list.html` ← template `templates/base.html`
```

Without it, a server-rendered page has no code pointer: React, Vue and Svelte expose their components in dev builds, Django templates do not. The agent has to search for the template itself, among hundreds.

## Install (development only)

```bash
pip install pointcast-django
```

```python
# settings.py
if DEBUG:
    INSTALLED_APPS += ["pointcast_django"]
```

That is all. Nothing else changes in your project: no middleware, no template backend, no template edits. Until the package is on PyPI, install it from this folder: `pip install ./integrations/django` in a clone of pointcast, or `pip install "git+https://github.com/Hugelidus/pointcast#subdirectory=integrations/django"`.

Then record with the pointcast extension as usual. The code locations (`text at:`) are resolved when your agent reads the recording through the pointcast MCP server, or with `pointcast process --repo <project folder>`: they need your source, which only exists on your machine.

## What it does

While `DEBUG` is true, the output of every project template that renders HTML is wrapped in two HTML comments naming it, relative to your project (`BASE_DIR`):

```html
<!-- pointcast:begin file="templates/pim/partials/row.html" name="pim/partials/row.html" --><tr id="product-A-100">
  …
</tr><!-- pointcast:end file="templates/pim/partials/row.html" -->
```

- **Pages, `{% include %}`, `{% extends %}`.** Each included template gets its own markers. A page that extends `base.html` is represented by its blocks: the blocks it overrides are wrapped with its own name, so the page's content points at the page's template and the navigation at `base.html`.
- **HTMX.** A partial rendered for an HTMX request is wrapped like any template, so the markers travel with the swapped HTML and the extension finds them wherever the swap put them.
- **App templates** (`APP_DIRS`) are named by their path in the project too: `pim/templates/pim/partials/status.html`.

The extension reads the markers around the element you Alt+click, innermost first, at most three, into the recording's code chain (`renderedBy`). The pointcast resolver then looks the element's text up in those templates, and in the templates they `{% include %}` by name when the chain alone has nothing. Comments (`{# #}`, `{% comment %}`, `<!-- -->`) and the page title are not searched.

## What it never does

- **Nothing in production.** With `DEBUG` off, nothing is installed, and every render checks the setting again (Django's test runner turns `DEBUG` off, so your tests see your real HTML).
- **Nothing outside HTML.** A template is wrapped only when its file ends in `.html`, `.htm` or `.djhtml` and its output, trimmed, starts with `<` and ends with `>`. Text emails (`.txt`), JSON, XML, a value rendered inside an attribute or a `<title>`, a partial that renders plain text: all unchanged. The `<!DOCTYPE>` stays first.
- **No absolute paths.** Only templates inside `BASE_DIR` are named, relative to it. Templates of Django itself, the admin and third-party apps (anything under `site-packages`, `dist-packages` or `node_modules`, or outside the project) get no markers, and a path that could break the comment is never written.
- **Only comments.** The markers add HTML comments and nothing else: the rest of the output is byte-identical (tested).

One thing to know: an HTML email rendered from a `.html` template in development carries the markers too. They are comments, invisible in mail clients, and gone in production.

## Settings (optional)

| Setting | Default | |
|---|---|---|
| `POINTCAST_TEMPLATE_MARKERS` | `DEBUG` | Force the markers on or off. |
| `POINTCAST_BASE_DIR` | `BASE_DIR`, else the current directory | The folder paths are relative to. Set it when your settings have no `BASE_DIR`. |

## How it hooks in

Two small hooks in Django's template engine, installed once in `AppConfig.ready()` when the markers are on:

- `Template.compile_nodelist` returns each template's top-level node list as a subclass that wraps its own output. Every render goes through it, including those that bypass `Template._render` (django-debug-toolbar's templates panel replaces that method while it records).
- `BlockNode.render` wraps a block overridden by a child template in the child's markers.

Supported: Django 4.2 and later, with the Django template language. Jinja2 templates (`django.template.backends.jinja2`) get no markers yet.

## Development

```bash
python -m venv .venv && .venv/bin/pip install "django>=4.2"
.venv/bin/python -m unittest discover -s integrations/django/tests
```

The tests render a mini project (`tests/project`) and compare the HTML with `tests/fixtures`, which the extension's tests (`packages/extension/src/lib/server-templates.test.ts`) parse and resolve against the same project. After changing the templates or the markers, regenerate the fixtures with `POINTCAST_WRITE_FIXTURES=1`.

## License

MIT
