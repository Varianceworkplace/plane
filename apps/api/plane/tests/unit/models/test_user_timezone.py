# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""A new account starts on the organisation's time zone (settings.DEFAULT_USER_TIMEZONE: India for Variance), not
the field's UTC default; a time zone given on creation is kept, bots keep UTC, and existing accounts are untouched."""

from uuid import uuid4

import pytest

from plane.db.models import User


def _new(**fields):
    uid = uuid4().hex[:8]
    return User.objects.create(email=f"tz-{uid}@plane.so", username=f"tz_{uid}", **fields)


@pytest.mark.unit
@pytest.mark.django_db
class TestNewAccountTimezone:
    @pytest.fixture(autouse=True)
    def india(self, settings):
        # the test settings keep UTC for the other tests; this is the real default
        settings.DEFAULT_USER_TIMEZONE = "Asia/Kolkata"

    def test_a_new_account_starts_on_india_time(self):
        assert _new().user_timezone == "Asia/Kolkata"

    def test_a_time_zone_given_is_kept(self):
        assert _new(user_timezone="Europe/London").user_timezone == "Europe/London"

    def test_bots_keep_utc(self):
        assert _new(is_bot=True).user_timezone == "UTC"

    def test_an_existing_account_keeps_its_choice(self):
        user = _new()
        user.user_timezone = "UTC"  # chosen later in their profile
        user.save()
        user.refresh_from_db()
        assert user.user_timezone == "UTC"
