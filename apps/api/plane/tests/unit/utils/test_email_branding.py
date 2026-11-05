# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import re
from pathlib import Path

import pytest
from django.conf import settings
from django.template.loader import render_to_string

from plane.utils.templatetags.branding import email_logo_url

EMAIL_TEMPLATES = Path(settings.TEMPLATES[0]["DIRS"][0]).resolve() / "emails"
# apps/web/public/logos, next to apps/api in the repo (absent when only apps/api is mounted)
WEB_LOGOS = Path(__file__).resolve().parents[5] / "web" / "public" / "logos"


def _logo_templates():
    return sorted(path for path in EMAIL_TEMPLATES.rglob("*.html") if "email_logo_url" in path.read_text())


@pytest.mark.unit
class TestEmailLogo:
    """Emails show the Variance logo from the instance's own web address, not Plane's."""

    def test_light_and_dark_logos_come_from_the_web_url(self, settings):
        settings.WEB_URL = "https://crm.example.com/"
        assert email_logo_url("light") == "https://crm.example.com/logos/variance-email-on-light.png"
        assert email_logo_url("dark") == "https://crm.example.com/logos/variance-email-on-dark.png"

    def test_logo_files_exist_in_the_web_app(self):
        if not WEB_LOGOS.parent.exists():
            pytest.skip("web app is not part of this checkout")
        assert (WEB_LOGOS / "variance-email-on-light.png").is_file()
        assert (WEB_LOGOS / "variance-email-on-dark.png").is_file()

    def test_every_email_renders_with_the_variance_logo(self, settings):
        settings.WEB_URL = "https://crm.example.com"
        templates = _logo_templates()
        assert len(templates) == 11
        for path in templates:
            html = render_to_string(str(path.relative_to(EMAIL_TEMPLATES.parent)), {})
            assert html.startswith("<!DOCTYPE"), path.name
            assert re.search(r'src="https://crm\.example\.com/logos/variance-email-on-(light|dark)\.png"', html), (
                path.name
            )
            assert "media.docs.plane.so" not in html, path.name
