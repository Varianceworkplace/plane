# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The sidebar Projects list: each person's own list of projects ("Show in List" / "Hide from List").

  * Everyone can show or hide any project they're a member of; the choice is theirs alone and is kept per project
    (ProjectUserProperty.show_in_list), so it is the same on every device.
  * Until they choose, a project is in their list, except for Project Managers (with role-based access on): theirs
    only start with the projects they created, lead, or that a team they lead owns or is assigned.
  * It is only the list. The Projects page (All Projects) still lists every project the person may see, and
    showing or hiding a project changes no membership, ownership, assignment or permission.
"""

# Django imports
from django.db.models import BooleanField, Case, OuterRef, Q, Subquery, Value, When
from django.db.models.functions import Coalesce

# Module imports
from plane.utils.rbac import rbac_profile


def in_my_list_annotation(request, slug):
    """Expression for Project querysets: whether the project is in the request user's sidebar Projects list."""
    from plane.db.models import ProjectUserProperty

    user_id = request.user.id
    choice = ProjectUserProperty.objects.filter(user_id=user_id, project_id=OuterRef("pk")).values("show_in_list")[:1]
    profile = rbac_profile(request, slug)
    if profile is not None and profile.uses_own_project_list:
        default = Case(
            When(
                Q(created_by_id=user_id) | Q(project_lead_id=user_id) | Q(pk__in=list(profile.led_project_ids)),
                then=Value(True),
            ),
            default=Value(False),
            output_field=BooleanField(),
        )
    else:
        default = Value(True)
    return Coalesce(Subquery(choice, output_field=BooleanField()), default, output_field=BooleanField())
