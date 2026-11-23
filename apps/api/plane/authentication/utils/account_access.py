# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Who may sign in or get an account, checked before anything is emailed.

* A disabled member (Access control > People > Disable, see plane.utils.member_removal) gets no sign-in codes or
  reset links: the sign-in itself would refuse them anyway.
* With sign-up turned off, only someone with an open invitation may create an account, so nobody else is shown a
  sign-up form or sent a code.
"""

import os

from plane.db.models import WorkspaceMemberInvite
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.workspace_invites import open_invites


def is_deactivated(user):
    """Disabled on purpose (not merely a never-used provisioned account): the same rule the sign-in applies."""
    return bool(user) and not user.is_active and user.last_logout_time is not None


def signup_allowed(email):
    (enable_signup,) = get_configuration_value(
        [{"key": "ENABLE_SIGNUP", "default": os.environ.get("ENABLE_SIGNUP", "1")}]
    )
    return enable_signup != "0" or open_invites(WorkspaceMemberInvite.objects.filter(email=email)).exists()
