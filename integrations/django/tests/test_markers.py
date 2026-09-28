"""pointcast-django on a mini project (tests/project): python -m unittest discover -s integrations/django/tests

The rendered page and HTMX partial are compared with the committed fixtures in tests/fixtures,
which the extension's vitest (packages/extension/src/lib/server-templates.test.ts) parses and
resolves. After changing the templates or the markers, regenerate them with
POINTCAST_WRITE_FIXTURES=1.
"""

import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE / "project"
FIXTURES = HERE / "fixtures"
sys.path[:0] = [str(HERE.parent), str(PROJECT)]

import django  # noqa: E402
from django.conf import settings  # noqa: E402

if not settings.configured:
    settings.configure(
        DEBUG=True,
        BASE_DIR=PROJECT,
        INSTALLED_APPS=["pim", "pointcast_django"],
        TEMPLATES=[
            {
                "BACKEND": "django.template.backends.django.DjangoTemplates",
                # The second folder stands for templates outside the project (a library's).
                "DIRS": [PROJECT / "templates", HERE / "outside" / "templates"],
                "APP_DIRS": True,
            }
        ],
    )
    django.setup()

from django.template import Context, Engine  # noqa: E402
from django.template.base import Template  # noqa: E402
from django.template.loader import render_to_string  # noqa: E402
from django.template.loader_tags import BlockNode  # noqa: E402
from django.test.utils import instrumented_test_render, override_settings  # noqa: E402

from pointcast_django import markers  # noqa: E402

PRODUCTS = [
    {"sku": "A-100", "name": "Silla Nórdica", "active": True},
    {"sku": "B-200", "name": "Mesa Roble", "active": False},
]


def begin(file, name):
    return f'<!-- pointcast:begin file="{file}" name="{name}" -->'


def end(file):
    return f'<!-- pointcast:end file="{file}" -->'


def plain(name, context):
    """The template rendered by Django's own methods: a fresh engine, compiled without the hooks."""
    markers.uninstall()
    try:
        engine = Engine(dirs=settings.TEMPLATES[0]["DIRS"], app_dirs=True)
        return engine.get_template(name).render(Context(context))
    finally:
        markers.install()


class Markers(unittest.TestCase):
    def check_fixture(self, name, html):
        path = FIXTURES / name
        if os.environ.get("POINTCAST_WRITE_FIXTURES") == "1":
            path.parent.mkdir(exist_ok=True)
            path.write_text(html, encoding="utf-8", newline="\n")
        self.assertEqual(path.read_text(encoding="utf-8"), html, f"{name} is stale: rerun with POINTCAST_WRITE_FIXTURES=1")

    def test_page_wraps_every_project_template(self):
        html = render_to_string("pim/list.html", {"products": PRODUCTS})
        # The doctype stays first; base.html wraps the document (list.html extends it, so it is
        # not wrapped as a whole), and list.html's block, each row and each status are wrapped.
        self.assertTrue(html.startswith("<!DOCTYPE html>" + begin("templates/base.html", "base.html")))
        self.assertTrue(html.rstrip().endswith(end("templates/base.html")))
        self.assertEqual(html.count(begin("templates/pim/list.html", "pim/list.html")), 1)
        self.assertEqual(html.count(begin("templates/pim/partials/row.html", "pim/partials/row.html")), 2)
        # An app directory template: its path is relative to the project too.
        self.assertEqual(html.count(begin("pim/templates/pim/partials/status.html", "pim/partials/status.html")), 2)
        for file in ["templates/base.html", "templates/pim/list.html", "templates/pim/partials/row.html"]:
            self.assertEqual(html.count(f"pointcast:begin file=\"{file}\""), html.count(end(file)))
        # A block whose output is text (the <title>) is never wrapped.
        self.assertIn("<title>Productos</title>", html)
        # No absolute path.
        self.assertNotIn(str(PROJECT), html)
        self.assertNotIn(str(PROJECT).replace("\\", "/"), html)
        self.check_fixture("list.html", html)

    def test_htmx_partial_carries_its_own_markers(self):
        html = render_to_string("pim/partials/row.html", {"product": {"sku": "C-300", "name": "Lámpara Arco", "active": True}})
        self.assertTrue(html.startswith(begin("templates/pim/partials/row.html", "pim/partials/row.html") + "<tr"))
        self.assertTrue(html.rstrip().endswith(end("templates/pim/partials/row.html")))
        self.check_fixture("row-htmx.html", html)

    def test_markers_only_add_comments(self):
        wrapped = render_to_string("pim/list.html", {"products": PRODUCTS})
        stripped = wrapped
        for piece in wrapped.split("<!-- pointcast:")[1:]:
            stripped = stripped.replace("<!-- pointcast:" + piece.split("-->")[0] + "-->", "", 1)
        self.assertEqual(stripped, plain("pim/list.html", {"products": PRODUCTS}))

    def test_non_html_is_never_wrapped(self):
        # A .txt email that looks like HTML, a JSON template, and a template whose output is text.
        for name in ["emails/welcome.txt", "api/product.json", "pim/label.html"]:
            context = {"name": "Ana", "product": PRODUCTS[0]}
            self.assertEqual(render_to_string(name, context), plain(name, context), name)
            self.assertNotIn("pointcast:", render_to_string(name, context), name)

    def test_templates_outside_the_project_are_not_named(self):
        html = render_to_string("pim/with_vendor.html", {})
        self.assertIn(begin("templates/pim/with_vendor.html", "pim/with_vendor.html"), html)
        self.assertIn('<div class="card"><em>third-party widget</em>\n</div>', html)
        self.assertNotIn("vendor/widget.html", html)
        self.assertNotIn("outside", html)

    def test_nothing_changes_without_debug(self):
        for name, context in [("pim/list.html", {"products": PRODUCTS}), ("pim/partials/row.html", {"product": PRODUCTS[0]})]:
            with override_settings(DEBUG=False):
                self.assertEqual(render_to_string(name, context), plain(name, context))
            with override_settings(DEBUG=True, POINTCAST_TEMPLATE_MARKERS=False):
                self.assertEqual(render_to_string(name, context), plain(name, context))

    def test_app_does_not_patch_in_production(self):
        from pointcast_django.apps import PointcastDjangoConfig
        import pointcast_django

        markers.uninstall()
        try:
            with override_settings(DEBUG=False):
                PointcastDjangoConfig("pointcast_django", pointcast_django).ready()
            self.assertEqual(markers._originals, {})
            self.assertEqual(Template.compile_nodelist.__qualname__, "Template.compile_nodelist")
            self.assertEqual(BlockNode.render.__qualname__, "BlockNode.render")
        finally:
            markers.install()

    def test_renders_that_bypass_template_render_keep_their_markers(self):
        # django-debug-toolbar's templates panel (and Django's test runner) swap Template._render
        # for this function, which renders the node list directly.
        saved = Template._render
        Template._render = instrumented_test_render
        try:
            html = render_to_string("pim/list.html", {"products": PRODUCTS})
        finally:
            Template._render = saved
        self.assertEqual(html, render_to_string("pim/list.html", {"products": PRODUCTS}))

    def test_project_path_refuses_unsafe_names(self):
        class Origin:
            def __init__(self, name, template_name=None):
                self.name = name
                self.template_name = template_name

        self.assertIsNone(markers.marker_attributes(Origin(str(PROJECT / "templates" / "a--b.html"))))
        self.assertIsNone(markers.marker_attributes(Origin(str(PROJECT / ".venv" / "Lib" / "site-packages" / "x" / "t.html"))))
        self.assertIsNone(markers.marker_attributes(Origin("<unknown source>")))
        self.assertEqual(
            markers.marker_attributes(Origin(str(PROJECT / "templates" / "ok.html"), 'o"k.html')),
            'file="templates/ok.html"',
        )


if __name__ == "__main__":
    unittest.main()
