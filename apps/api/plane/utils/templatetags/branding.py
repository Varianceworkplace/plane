# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django import template
from django.conf import settings

register = template.Library()

# Served by the web app from apps/web/public/logos, so emails load the logo from the instance's own address
EMAIL_LOGOS = {
    "light": "variance-email-on-light.png",  # dark lettering, for white email headers
    "dark": "variance-email-on-dark.png",  # white lettering, for black email headers
}


@register.simple_tag
def email_logo_url(background="light"):
    """Absolute URL of the Variance logo for an email header with a light or dark background."""
    return f"{(settings.WEB_URL or '').rstrip('/')}/logos/{EMAIL_LOGOS[background]}"
