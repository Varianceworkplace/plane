# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Role-based access, step 8 (rollout): what turning it on would change in a workspace,
worked out without changing anything, for the Access control overview and the `rbac_rollout` command.
"""

# Django imports
from django.db.models import Q

ROLE_ADMIN = 20


def rollout_preview(workspace):
    """Per person: roles, teams, the work items they see today and with role-based access on, the projects they'd see
    and change, and the project memberships the sync would add or raise. Plus what's worth fixing first."""
    from plane.db.models import Issue, Project, ProjectMember, ProjectTeam, TeamMember, UserRole, WorkspaceMember
    from plane.db.models.workspace import Team
    from plane.utils.rbac import AccessProfile, desired_project_roles
    from plane.utils.work_item_visibility import all_work_items, visible_to

    with all_work_items():
        memberships = (
            WorkspaceMember.objects.filter(workspace=workspace, is_active=True, member__is_bot=False)
            .select_related("member")
            .order_by("-role", "member__display_name")
        )
        roles_by_member = {}
        for member_id, name in UserRole.objects.filter(workspace=workspace, role__deleted_at__isnull=True).values_list(
            "member_id", "role__name"
        ):
            roles_by_member.setdefault(member_id, []).append(name)
        teams_by_member = {}
        for member_id, name, is_lead in TeamMember.objects.filter(workspace=workspace).values_list(
            "member_id", "team__name", "is_lead"
        ):
            teams_by_member.setdefault(member_id, []).append({"name": name, "is_lead": is_lead})

        work_items = Issue.issue_objects.filter(workspace=workspace)
        projects = Project.objects.filter(workspace=workspace, archived_at__isnull=True)
        rows = {
            (row.project_id, row.member_id): row
            for row in ProjectMember.objects.filter(workspace=workspace, member__isnull=False)
        }
        desired = desired_project_roles(workspace.id)

        people = []
        for membership in memberships:
            user = membership.member
            profile = AccessProfile.load(user, workspace.id)
            is_admin = membership.role == ROLE_ADMIN
            after = work_items.filter(profile.work_item_q("view")).count()
            if workspace.is_rbac_enabled:
                now = after
            else:
                # today: the private-work-item rule, in the projects they belong to (admins: every project)
                own_projects = ProjectMember.objects.filter(member=user, workspace=workspace, is_active=True)
                in_projects = Q() if is_admin else Q(project_id__in=own_projects.values("project_id"))
                now = work_items.filter(visible_to(user) & in_projects).count()
            added = raised = 0
            for (project_id, user_id), role in desired.items():
                if user_id != user.id:
                    continue
                row = rows.get((project_id, user_id))
                if row is None or not row.is_active:
                    added += 1
                elif row.role < role:
                    raised += 1
            people.append(
                {
                    "member_id": str(user.id),
                    "workspace_role": membership.role,
                    "is_workspace_admin": is_admin,
                    "roles": roles_by_member.get(user.id, []),
                    "teams": teams_by_member.get(user.id, []),
                    "work_items": {"now": now, "after": after},
                    "projects": {
                        "view": projects.filter(profile.project_q("view")).count(),
                        "edit": projects.filter(profile.project_q("edit")).count(),
                    },
                    "memberships": {"added": 0 if workspace.is_rbac_enabled else added, "raised": raised},
                }
            )

        lead_team_ids = set(
            TeamMember.objects.filter(workspace=workspace, is_lead=True).values_list("team_id", flat=True)
        )
        owned_project_ids = ProjectTeam.objects.filter(workspace=workspace).values("project_id")
        return {
            "is_rbac_enabled": workspace.is_rbac_enabled,
            "people": people,
            "warnings": {
                # no projects or work items until someone gives them a role
                "without_role": [p["member_id"] for p in people if not p["roles"] and not p["is_workspace_admin"]],
                "teams_without_lead": sorted(
                    Team.objects.filter(workspace=workspace)
                    .exclude(pk__in=lead_team_ids)
                    .values_list("name", flat=True)
                ),
                # only HR and admins can change these; no PM manages them
                "projects_without_team": sorted(
                    projects.exclude(pk__in=owned_project_ids).values_list("name", flat=True)
                ),
                "seeing_fewer_work_items": [
                    p["member_id"] for p in people if p["work_items"]["after"] < p["work_items"]["now"]
                ],
            },
        }
