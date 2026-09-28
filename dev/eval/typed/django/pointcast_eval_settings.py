# Settings for running mdn/django-locallibrary-tutorial in the Pointcast evaluation
# (dev/eval/typed; the 2026-09-28 run used this file with the database next to it).
# Kept OUTSIDE the app's folder, so the agent under test never sees it: the app's own source is
# unchanged. pointcast-django is installed as its README says (only under DEBUG).
import os
from pathlib import Path

from locallibrary.settings import *  # noqa: F401,F403

DEBUG = True
if DEBUG:
    INSTALLED_APPS = [*INSTALLED_APPS, "pointcast_django"]  # noqa: F405

# The database lives outside the app folder the agent searches (default: dev/eval/.runs, ignored by git).
_DB = os.environ.get("EVAL_DJANGO_DB") or Path(__file__).resolve().parents[2] / ".runs" / "locallibrary.sqlite3"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": _DB}}
# Plain static storage: no collectstatic manifest is needed with runserver.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
