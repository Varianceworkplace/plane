# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Wrong passwords counted per account, whichever address or headers they come from.

The per-IP limit (plane.authentication.rate_limit) identifies callers by the X-Forwarded-For header, which a
client can set to anything, so on its own it doesn't stop someone guessing one person's password. This does:
after MAX_FAILED wrong passwords for an email within WINDOW_SECONDS, that account's password sign-in is refused
(even with the right password) until the window ends. A successful sign-in clears the count.
"""

import os

from django.core.cache import cache

MAX_FAILED = int(os.environ.get("PASSWORD_ATTEMPTS_PER_ACCOUNT", "10"))
WINDOW_SECONDS = 15 * 60


def _key(email):
    return f"auth:failed_password:{str(email or '').strip().lower()}"


def too_many_failed_passwords(email):
    return (cache.get(_key(email)) or 0) >= MAX_FAILED


def record_failed_password(email):
    key = _key(email)
    # the window starts at the first failure and isn't extended by later ones
    cache.add(key, 0, WINDOW_SECONDS)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, WINDOW_SECONDS)


def clear_failed_passwords(email):
    cache.delete(_key(email))
