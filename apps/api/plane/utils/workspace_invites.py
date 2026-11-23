# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace invitations: how long they stay open, and whether their email went out.

* An invitation stays open for INVITE_VALID_DAYS after it was last sent (or changed): its updated_at, which the
  email job refreshes as it sends and a resend refreshes too. After that its link and the email match stop
  working, and it no longer opens sign-up when sign-up is turned off, until someone sends it again.
* What happened to its last email ("sent", "failed", "not_configured") is kept for a while in Redis, so the
  Members page can show it without a database change. Losing it only loses that note.
"""

import json
from datetime import timedelta

from django.utils import timezone

from plane.license.utils.instance_value import get_email_configuration
from plane.settings.redis import redis_instance
from plane.utils.exception_logger import log_exception

INVITE_VALID_DAYS = 7
EMAIL_STATUS_TTL_SECONDS = 60 * 60 * 24 * 30


def invite_expires_at(invite):
    return invite.updated_at + timedelta(days=INVITE_VALID_DAYS)


def invite_is_expired(invite):
    return timezone.now() >= invite_expires_at(invite)


def open_invites(queryset):
    """Invitations nobody has answered yet that are still within their validity."""
    return queryset.filter(responded_at__isnull=True, updated_at__gt=timezone.now() - timedelta(days=INVITE_VALID_DAYS))


def email_is_configured():
    (email_host, *_rest) = get_email_configuration()
    return bool(email_host)


def _email_key(invite_id):
    return f"workspace_invite_email:{invite_id}"


def record_invite_email(invite_id, status, error=""):
    try:
        redis_instance().set(
            _email_key(invite_id),
            json.dumps({"status": status, "at": timezone.now().isoformat(), "error": str(error)[:200]}),
            ex=EMAIL_STATUS_TTL_SECONDS,
        )
    except Exception as e:
        log_exception(e)


def invite_email_status(invite_id):
    try:
        raw = redis_instance().get(_email_key(invite_id))
        return json.loads(raw) if raw else None
    except Exception:
        return None
