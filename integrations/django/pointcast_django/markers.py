"""Dev-only template markers for pointcast's code pointer.

While ``settings.DEBUG`` is true, the output of every project template that renders HTML is
wrapped in two comments naming the template, relative to the project::

    <!-- pointcast:begin file="templates/pim/partials/row.html" name="pim/partials/row.html" -->
    ...the template's output...
    <!-- pointcast:end file="templates/pim/partials/row.html" -->

The pointcast extension reads the markers around an Alt+clicked element (innermost first) into
the recording's code chain, and the resolver finds the element's text in those files.

How: when the app is ready, and only if the markers are on (DEBUG), two hooks are installed in
Django's template engine; each render checks the setting again, so ``override_settings`` and
Django's test runner (which sets DEBUG to False) turn them off:

- ``Template.compile_nodelist`` returns the template's top-level node list as a ``NodeList``
  subclass that wraps its own output. Every render of a template goes through that list: pages,
  ``{% include %}``, the parents of ``{% extends %}``, partials rendered for HTMX requests, and
  also renders that bypass ``Template._render`` (django-debug-toolbar's templates panel and the
  test runner replace that method). A template that extends another is not wrapped as a whole:
  its output is its parent's.
- ``BlockNode.render``: a block overridden by a child template is wrapped with the child's
  markers, so the page's main content points at the template it is written in.

What is never wrapped, so no output other than a dev HTML page changes:

- anything while the markers are off: in production nothing is even installed;
- output that does not look like HTML (stripped, it must start with ``<`` and end with ``>``):
  JSON, text, a value inside an attribute or a ``<title>``;
- templates whose file does not end in ``.html``, ``.htm`` or ``.djhtml`` (``.txt`` emails,
  ``.json``, ``.xml``, ``.js``);
- templates outside the project (``BASE_DIR``), or under ``site-packages``/``dist-packages``/
  ``node_modules``: the admin's and third-party apps' templates are not the app's code, and an
  absolute path must never reach the page. Templates made from a string have no file either.

A ``<!DOCTYPE>`` stays first: the begin marker goes right after it.

Settings (all optional):

- ``POINTCAST_TEMPLATE_MARKERS``: force the markers on or off; default ``DEBUG``.
- ``POINTCAST_BASE_DIR``: the project root paths are relative to; default ``BASE_DIR``, else
  the current directory.
"""

from __future__ import annotations

import os
import re
from typing import Optional

from django.conf import settings
from django.template.base import NodeList, Template
from django.template.loader_tags import BLOCK_CONTEXT_KEY, BlockNode, ExtendsNode
from django.utils.safestring import mark_safe

HTML_EXTENSIONS = (".html", ".htm", ".djhtml")
NOT_PROJECT_SEGMENTS = {"site-packages", "dist-packages", "node_modules"}
DOCTYPE = re.compile(r"\s*<!doctype[^>]*>", re.IGNORECASE)
# Characters that could end the comment or the attribute early: such a path is never written.
UNSAFE = re.compile(r'--|[<>"\r\n]')

_originals: dict = {}


def enabled() -> bool:
    value = getattr(settings, "POINTCAST_TEMPLATE_MARKERS", None)
    return bool(settings.DEBUG if value is None else value)


def base_dir() -> str:
    root = getattr(settings, "POINTCAST_BASE_DIR", None) or getattr(settings, "BASE_DIR", None) or os.getcwd()
    return os.path.abspath(str(root))


def project_path(origin) -> Optional[str]:
    """The template's file relative to the project, with forward slashes; None when it is not
    a project file (outside BASE_DIR, a library, a string template)."""
    name = getattr(origin, "name", None)
    if not isinstance(name, str) or not os.path.isabs(name):
        return None
    root = base_dir()
    path = os.path.abspath(name)
    try:
        if os.path.commonpath([os.path.normcase(root), os.path.normcase(path)]) != os.path.normcase(root):
            return None
    except ValueError:  # another drive on Windows
        return None
    relative = os.path.relpath(path, root).replace(os.sep, "/")
    if relative.startswith("..") or NOT_PROJECT_SEGMENTS.intersection(relative.split("/")):
        return None
    return relative


def marker_attributes(origin) -> Optional[str]:
    """``file="…" name="…"`` for a project HTML template, else None."""
    file = project_path(origin)
    if file is None or not file.lower().endswith(HTML_EXTENSIONS) or UNSAFE.search(file):
        return None
    name = getattr(origin, "template_name", None)
    attributes = f'file="{file}"'
    if isinstance(name, str) and name and not UNSAFE.search(name):
        attributes += f' name="{name}"'
    return attributes


def wrap(output, origin):
    """The output between the template's markers when it is project HTML; else unchanged."""
    if not enabled():
        return output
    text = str(output)
    stripped = text.strip()
    if not (stripped.startswith("<") and stripped.endswith(">")):
        return output
    attributes = marker_attributes(origin)
    if attributes is None:
        return output
    file = attributes.split('"')[1]
    doctype = DOCTYPE.match(text)
    head, body = (text[: doctype.end()], text[doctype.end() :]) if doctype else ("", text)
    content = body.rstrip()
    begin = f"<!-- pointcast:begin {attributes} -->"
    end = f'<!-- pointcast:end file="{file}" -->'
    return mark_safe(f"{head}{begin}{content}{end}{body[len(content):]}")


class TemplateNodeList(NodeList):
    """A template's top-level nodes: renders them, then wraps the output in its markers."""

    origin = None
    extends = False

    def render(self, context):
        output = super().render(context)
        return output if self.extends else wrap(output, self.origin)


def install() -> None:
    """Installs the two hooks, once. Called by the app config only when the markers are on."""
    if _originals:
        return
    compile_nodelist = Template.compile_nodelist
    block_render = BlockNode.render
    _originals.update(compile_nodelist=compile_nodelist, block_render=block_render)

    def compile_with_markers(self):
        nodelist = compile_nodelist(self)
        marked = TemplateNodeList(nodelist)
        marked.contains_nontext = nodelist.contains_nontext
        marked.origin = self.origin
        marked.extends = any(isinstance(node, ExtendsNode) for node in nodelist)
        return marked

    def render_block(self, context):
        # The block that will render: the most derived override (what BlockNode.render pops).
        block_context = context.render_context.get(BLOCK_CONTEXT_KEY)
        rendered = block_context.get_block(self.name) if block_context is not None else None
        output = block_render(self, context)
        origin = getattr(rendered, "origin", None)
        if origin is None or origin == getattr(self, "origin", None):
            return output
        return wrap(output, origin)

    Template.compile_nodelist = compile_with_markers
    BlockNode.render = render_block


def uninstall() -> None:
    """Removes the hooks (tests). Templates compiled meanwhile keep their node list, which
    wraps nothing once the markers are off."""
    if not _originals:
        return
    Template.compile_nodelist = _originals.pop("compile_nodelist")
    BlockNode.render = _originals.pop("block_render")
