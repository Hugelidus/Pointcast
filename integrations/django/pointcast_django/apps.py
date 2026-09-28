from django.apps import AppConfig


class PointcastDjangoConfig(AppConfig):
    name = "pointcast_django"
    verbose_name = "pointcast (dev template markers)"

    def ready(self) -> None:
        # Nothing is patched unless the markers are on (DEBUG by default): production templates
        # render through Django's own, untouched methods.
        from . import markers

        if markers.enabled():
            markers.install()
