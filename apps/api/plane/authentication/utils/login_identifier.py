# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Signing in with a username as well as an email address.

Staff know their username from the old CRM (the import kept it), so the sign-in box takes either. Each entry point
(email check, password sign-in, sign-in code, forgot password) turns what was typed into the account's email address
here, and the rest of sign-in carries on unchanged. Whatever goes back to the browser (error redirects, responses)
keeps what was typed, so typing someone's username never shows their email address.
"""

from plane.db.models import User


def is_username(identifier):
    """No "@": a username rather than an email address."""
    return "@" not in str(identifier or "")


def login_email(identifier):
    """The email address to sign in with.

    An email address comes back as typed (trimmed, lower-cased, as sign-in always did). A username comes back as the
    email address of the person with that username (an exact match first, otherwise one whose username differs only
    in case), or "" when there's no such person (or more than one).
    """
    value = str(identifier or "").strip()
    if not value:
        return ""
    if not is_username(value):
        return value.lower()
    people = User.objects.filter(is_bot=False)
    exact = people.filter(username=value).values_list("email", flat=True).first()
    if exact:
        return exact
    matches = list(people.filter(username__iexact=value).values_list("email", flat=True)[:2])
    return matches[0] if len(matches) == 1 else ""


def as_typed(params, identifier):
    """Error details for the browser, with the address swapped back to what was typed (a username stays a username)."""
    if "email" in params and identifier:
        params["email"] = str(identifier).strip()
    return params
