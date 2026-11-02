# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Role-based access: the admin screens' API (step 6 of the RBAC plan).

  * Workspace admins and people whose roles grant "Role management" (HR) manage roles, who holds them, teams, the
    projects teams own and what a team's leads may do instead of their roles, and can check anyone's access. Only
    workspace admins switch role-based access on or off.
  * A project is shared (view only / manage, optionally until a date) by whoever may edit the project.
  * Every change brings project memberships back in step (plane.utils.rbac.sync_project_access).
"""

# Python imports
import uuid

# Django imports
from django.db import IntegrityError, transaction
from django.utils.dateparse import parse_datetime

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    RBAC_ACTIONS,
    RBAC_MODULES,
    RBAC_SCOPES,
    AccessGrant,
    MemberGroupMember,
    Project,
    ProjectMember,
    ProjectTeam,
    Role,
    RolePermission,
    TeamMember,
    TeamPermission,
    UserRole,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.rbac import GRANT_LEVELS, TEAM_PERMISSION_SCOPES, schedule_project_access_sync
from plane.db.models.workspace import Team
from plane.utils.rbac import AccessProfile
from plane.utils.rbac_rollout import rollout_preview

WORKSPACE_ROLES = [ROLE.ADMIN, ROLE.MEMBER]


# ---------------------------------------------------------------- helpers


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def is_workspace_admin(user, workspace):
    return WorkspaceMember.objects.filter(
        workspace=workspace, member=user, role=ROLE.ADMIN.value, is_active=True
    ).exists()


def can_manage_access(user, workspace):
    """Workspace admins, and people whose roles grant Role management (HR)."""
    return is_workspace_admin(user, workspace) or AccessProfile.load(user, workspace.id).can("role_management", "edit")


def forbidden():
    return Response(
        {"error": "Only workspace admins and people with Role management can do this."},
        status=status.HTTP_403_FORBIDDEN,
    )


def active_member_ids(workspace):
    return set(
        WorkspaceMember.objects.filter(workspace=workspace, is_active=True, member__is_bot=False).values_list(
            "member_id", flat=True
        )
    )


def serialize_role(role, holder_counts):
    return {
        "id": str(role.id),
        "name": role.name,
        "description": role.description,
        "key": role.key,
        "is_system": role.is_system,
        "holder_count": holder_counts.get(role.id, 0),
        "permissions": [{"module": p.module, "action": p.action, "scope": p.scope} for p in role.permissions.all()],
    }


def parse_permissions(value, scopes=RBAC_SCOPES):
    """Returns (rows, error) for a role's or a team's permissions: [{module, action, scope}], one scope per
    module/action."""
    if not isinstance(value, list):
        return None, "Send the permissions as a list."
    rows, seen = [], set()
    for item in value:
        if not isinstance(item, dict):
            return None, "Each permission needs a module, an action and a scope."
        module, action, scope = item.get("module"), item.get("action"), item.get("scope")
        if module not in RBAC_MODULES or action not in RBAC_ACTIONS or scope not in scopes:
            return None, f"Unknown permission: {module} / {action} / {scope}."
        if (module, action) in seen:
            return None, f"{RBAC_MODULES[module]}: {action} is listed twice."
        seen.add((module, action))
        rows.append((module, action, scope))
    return rows, None


def parse_role_fields(data, partial):
    """Returns (fields, errors) for a role's name and description."""
    fields, errors = {}, {}
    if "name" in data or not partial:
        name = data.get("name")
        name = name.strip() if isinstance(name, str) else ""
        if not name:
            errors["name"] = "Give the role a name."
        elif len(name) > 100:
            errors["name"] = "Keep the name under 100 characters."
        else:
            fields["name"] = name
    if "description" in data:
        description = data.get("description") or ""
        if not isinstance(description, str) or len(description) > 2000:
            errors["description"] = "Keep the description under 2000 characters."
        else:
            fields["description"] = description.strip()
    return fields, errors


def save_permissions(role, rows):
    RolePermission.objects.filter(role=role).delete(soft=False)
    RolePermission.objects.bulk_create(
        [RolePermission(role=role, module=module, action=action, scope=scope) for module, action, scope in rows]
    )


def serialize_team(team, members_by_team, projects_by_team, permissions_by_team):
    return {
        "id": str(team.id),
        "name": team.name,
        "description": team.description,
        "members": members_by_team.get(team.id, []),
        "project_ids": projects_by_team.get(team.id, []),
        "lead_permissions": permissions_by_team.get(team.id, []),
    }


def teams_payload(workspace, teams):
    members_by_team, projects_by_team, permissions_by_team = {}, {}, {}
    for team_id, member_id, is_lead in TeamMember.objects.filter(team__in=teams).values_list(
        "team_id", "member_id", "is_lead"
    ):
        members_by_team.setdefault(team_id, []).append({"member_id": str(member_id), "is_lead": is_lead})
    for team_id, project_id in ProjectTeam.objects.filter(team__in=teams).values_list("team_id", "project_id"):
        projects_by_team.setdefault(team_id, []).append(str(project_id))
    for team_id, module, action, scope in TeamPermission.objects.filter(team__in=teams).values_list(
        "team_id", "module", "action", "scope"
    ):
        permissions_by_team.setdefault(team_id, []).append({"module": module, "action": action, "scope": scope})
    return [serialize_team(team, members_by_team, projects_by_team, permissions_by_team) for team in teams]


def parse_team_members(workspace, value):
    """Returns (rows, error): [(member_id, is_lead)] of active workspace members, each once."""
    if not isinstance(value, list):
        return None, "Send the members as a list."
    allowed, rows, seen = active_member_ids(workspace), [], set()
    for item in value:
        member_id = _uuid(item.get("member_id")) if isinstance(item, dict) else None
        if member_id is None or member_id not in allowed:
            return None, "Pick members of this workspace."
        if member_id in seen:
            return None, "A person is listed twice."
        seen.add(member_id)
        rows.append((member_id, bool(item.get("is_lead"))))
    return rows, None


def parse_project_ids(workspace, value):
    if not isinstance(value, list):
        return None, "Send the projects as a list."
    ids = {_uuid(item) for item in value}
    if None in ids:
        return None, "Pick projects of this workspace."
    found = set(Project.objects.filter(workspace=workspace, pk__in=ids).values_list("id", flat=True))
    if found != ids:
        return None, "Pick projects of this workspace."
    return ids, None


def save_team_links(workspace, team, members, project_ids, lead_permissions=None):
    if lead_permissions is not None:
        TeamPermission.objects.filter(team=team).delete(soft=False)
        TeamPermission.objects.bulk_create(
            [
                TeamPermission(workspace=workspace, team=team, module=module, action=action, scope=scope)
                for module, action, scope in lead_permissions
            ]
        )
    if members is not None:
        TeamMember.objects.filter(team=team).delete(soft=False)
        for member_id, is_lead in members:
            TeamMember.objects.create(workspace=workspace, team=team, member_id=member_id, is_lead=is_lead)
    if project_ids is not None:
        ProjectTeam.objects.filter(team=team).exclude(project_id__in=project_ids).delete(soft=False)
        existing = set(ProjectTeam.objects.filter(team=team).values_list("project_id", flat=True))
        for project_id in project_ids - existing:
            ProjectTeam.objects.create(workspace=workspace, team=team, project_id=project_id)


# ---------------------------------------------------------------- overview and switch


class AccessControlEndpoint(BaseAPIView):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        return Response(
            {
                "is_rbac_enabled": workspace.is_rbac_enabled,
                "can_switch": is_workspace_admin(request.user, workspace),
                "modules": [{"key": key, "label": label} for key, label in RBAC_MODULES.items()],
                "actions": RBAC_ACTIONS,
                "scopes": RBAC_SCOPES,
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug):
        enabled = request.data.get("is_rbac_enabled")
        if not isinstance(enabled, bool):
            return Response({"is_rbac_enabled": "Send true or false."}, status=status.HTTP_400_BAD_REQUEST)
        workspace = Workspace.objects.get(slug=slug)
        workspace.is_rbac_enabled = enabled
        workspace.save(update_fields=["is_rbac_enabled"])
        return Response({"is_rbac_enabled": enabled}, status=status.HTTP_200_OK)


class RolloutPreviewEndpoint(BaseAPIView):
    """What turning role-based access on would change, per person (step 8); nothing is changed."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        return Response(rollout_preview(workspace), status=status.HTTP_200_OK)


class MyAccessEndpoint(BaseAPIView):
    """The signed-in person's own access (step 7), so the app hides what they can't do. The API still checks
    everything; with role-based access off only `is_rbac_enabled` and `can_manage_access` are sent."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        payload = {
            "is_rbac_enabled": workspace.is_rbac_enabled,
            "can_manage_access": can_manage_access(request.user, workspace),
        }
        if not workspace.is_rbac_enabled:
            return Response(payload, status=status.HTTP_200_OK)

        profile = AccessProfile.load(request.user, workspace.id)
        projects = Project.objects.filter(workspace=workspace)

        def ids(values):
            return None if values is None else sorted(str(value) for value in values)

        def project_ids(action):
            # None = every project
            q = profile.project_q(action)
            return None if not q else ids(projects.filter(q).values_list("id", flat=True))

        def create_work_item_ids():
            scopes = profile.scopes("work_items", "create")
            if "all" in scopes:
                return None
            found = set()
            if "team" in scopes:
                found |= profile.team_project_ids("create")
            if scopes & {"own", "member"}:
                found |= profile.create_member_project_ids
            return ids(found)

        payload.update(
            {
                "is_admin": profile.is_admin,
                # shown under the person's name in the profile menu
                "role_names": sorted(
                    UserRole.objects.filter(
                        workspace=workspace, member=request.user, role__deleted_at__isnull=True
                    ).values_list("role__name", flat=True)
                ),
                "permissions": {
                    module: {action: sorted(profile.scopes(module, action)) for action in RBAC_ACTIONS}
                    for module in RBAC_MODULES
                },
                "projects": {action: project_ids(action) for action in ("view", "edit", "delete")},
                "modules": {
                    module: {action: ids(profile.module_project_ids(module, action)) for action in RBAC_ACTIONS}
                    for module in ("milestones", "worklogs", "members")
                },
                # the people whose workspace role I may change (Employees and members › Edit); None = everyone
                "member_ids": {"edit": ids(profile.member_ids("edit"))},
                "work_items": {
                    "create_project_ids": create_work_item_ids(),
                    "member_project_ids": ids(profile.member_project_ids),
                    "team_project_ids": {action: ids(profile.team_project_ids(action)) for action in RBAC_ACTIONS},
                    "led_member_ids": ids(profile.led_member_ids),
                    # as the engine counts "claimed by a team"
                    "teamed_member_ids": ids(
                        TeamMember.objects.filter(workspace=workspace).values_list("member_id", flat=True)
                    ),
                    # the groups I'm in (I see their tasks), and the ones with people of the teams I lead
                    "group_ids": ids(profile.group_ids),
                    "led_group_ids": ids(
                        MemberGroupMember.objects.filter(
                            workspace=workspace, member_id__in=profile.led_member_ids, group__deleted_at__isnull=True
                        ).values_list("group_id", flat=True)
                    ),
                },
            }
        )
        return Response(payload, status=status.HTTP_200_OK)


# ---------------------------------------------------------------- roles


class RoleListCreateEndpoint(BaseAPIView):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        roles = Role.objects.filter(workspace=workspace).prefetch_related("permissions")
        counts = {}
        for role_id in UserRole.objects.filter(workspace=workspace).values_list("role_id", flat=True):
            counts[role_id] = counts.get(role_id, 0) + 1
        return Response([serialize_role(role, counts) for role in roles], status=status.HTTP_200_OK)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        fields, errors = parse_role_fields(request.data, partial=False)
        rows, error = parse_permissions(request.data.get("permissions", []))
        if error:
            errors["permissions"] = error
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                role = Role.objects.create(workspace=workspace, **fields)
                save_permissions(role, rows)
        except IntegrityError:
            return Response({"name": "A role with this name already exists."}, status=status.HTTP_400_BAD_REQUEST)
        schedule_project_access_sync(workspace.id)
        return Response(serialize_role(role, {}), status=status.HTTP_201_CREATED)


class RoleDetailEndpoint(BaseAPIView):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def patch(self, request, slug, pk):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        role = Role.objects.filter(workspace=workspace, pk=pk).first()
        if not role:
            return Response({"error": "Role not found."}, status=status.HTTP_404_NOT_FOUND)
        fields, errors = parse_role_fields(request.data, partial=True)
        rows = None
        if "permissions" in request.data:
            rows, error = parse_permissions(request.data.get("permissions"))
            if error:
                errors["permissions"] = error
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                for key, value in fields.items():
                    setattr(role, key, value)
                role.save()
                if rows is not None:
                    save_permissions(role, rows)
        except IntegrityError:
            return Response({"name": "A role with this name already exists."}, status=status.HTTP_400_BAD_REQUEST)
        schedule_project_access_sync(workspace.id)
        counts = {role.id: UserRole.objects.filter(role=role).count()}
        return Response(serialize_role(role, counts), status=status.HTTP_200_OK)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        role = Role.objects.filter(workspace=workspace, pk=pk).first()
        if not role:
            return Response({"error": "Role not found."}, status=status.HTTP_404_NOT_FOUND)
        if role.is_system:
            return Response({"error": "Built-in roles can't be deleted."}, status=status.HTTP_400_BAD_REQUEST)
        if UserRole.objects.filter(role=role).exists():
            return Response(
                {"error": "People still hold this role. Give them another role first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        RolePermission.objects.filter(role=role).delete(soft=False)
        role.delete(soft=False)
        schedule_project_access_sync(workspace.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- people


class AccessMembersEndpoint(BaseAPIView):
    """Everyone in the workspace with their roles and teams (People tab)."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        roles, teams = {}, {}
        for member_id, role_id in UserRole.objects.filter(workspace=workspace).values_list("member_id", "role_id"):
            roles.setdefault(member_id, []).append(str(role_id))
        for member_id, team_id, is_lead in TeamMember.objects.filter(workspace=workspace).values_list(
            "member_id", "team_id", "is_lead"
        ):
            teams.setdefault(member_id, []).append({"team_id": str(team_id), "is_lead": is_lead})
        rows = WorkspaceMember.objects.filter(workspace=workspace, is_active=True, member__is_bot=False).values_list(
            "member_id", "role"
        )
        return Response(
            [
                {
                    "member_id": str(member_id),
                    "workspace_role": role,
                    "role_ids": roles.get(member_id, []),
                    "teams": teams.get(member_id, []),
                }
                for member_id, role in rows
            ],
            status=status.HTTP_200_OK,
        )


class MemberRolesEndpoint(BaseAPIView):
    """Sets the roles one person holds (People tab, "who has this role")."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def put(self, request, slug, member_id):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        if member_id not in active_member_ids(workspace):
            return Response({"error": "Pick a member of this workspace."}, status=status.HTTP_400_BAD_REQUEST)
        value = request.data.get("role_ids")
        role_ids = {_uuid(item) for item in value} if isinstance(value, list) else {None}
        if None in role_ids or Role.objects.filter(workspace=workspace, pk__in=role_ids).count() != len(role_ids):
            return Response({"role_ids": "Pick roles of this workspace."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            UserRole.objects.filter(workspace=workspace, member_id=member_id).exclude(role_id__in=role_ids).delete(
                soft=False
            )
            existing = set(
                UserRole.objects.filter(workspace=workspace, member_id=member_id).values_list("role_id", flat=True)
            )
            for role_id in role_ids - existing:
                UserRole.objects.create(workspace=workspace, member_id=member_id, role_id=role_id)
        schedule_project_access_sync(workspace.id)
        return Response({"member_id": str(member_id), "role_ids": sorted(str(r) for r in role_ids)})


# ---------------------------------------------------------------- teams


class TeamListCreateEndpoint(BaseAPIView):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        teams = list(Team.objects.filter(workspace=workspace).order_by("name"))
        return Response(teams_payload(workspace, teams), status=status.HTTP_200_OK)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        name = request.data.get("name")
        name = name.strip() if isinstance(name, str) else ""
        errors = {}
        if not name:
            errors["name"] = "Give the team a name."
        members, error = parse_team_members(workspace, request.data.get("members", []))
        if error:
            errors["members"] = error
        project_ids, error = parse_project_ids(workspace, request.data.get("project_ids", []))
        if error:
            errors["project_ids"] = error
        lead_permissions, error = parse_permissions(request.data.get("lead_permissions", []), TEAM_PERMISSION_SCOPES)
        if error:
            errors["lead_permissions"] = error
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                team = Team.objects.create(
                    workspace=workspace, name=name, description=(request.data.get("description") or "").strip()
                )
                save_team_links(workspace, team, members, project_ids, lead_permissions)
        except IntegrityError:
            return Response({"name": "A team with this name already exists."}, status=status.HTTP_400_BAD_REQUEST)
        schedule_project_access_sync(workspace.id)
        return Response(teams_payload(workspace, [team])[0], status=status.HTTP_201_CREATED)


class TeamDetailEndpoint(BaseAPIView):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def patch(self, request, slug, pk):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        team = Team.objects.filter(workspace=workspace, pk=pk).first()
        if not team:
            return Response({"error": "Team not found."}, status=status.HTTP_404_NOT_FOUND)
        errors, members, project_ids, lead_permissions = {}, None, None, None
        if "name" in request.data:
            name = request.data.get("name")
            name = name.strip() if isinstance(name, str) else ""
            if not name:
                errors["name"] = "Give the team a name."
            team.name = name
        if "description" in request.data:
            team.description = (request.data.get("description") or "").strip()
        if "members" in request.data:
            members, error = parse_team_members(workspace, request.data.get("members"))
            if error:
                errors["members"] = error
        if "project_ids" in request.data:
            project_ids, error = parse_project_ids(workspace, request.data.get("project_ids"))
            if error:
                errors["project_ids"] = error
        if "lead_permissions" in request.data:
            lead_permissions, error = parse_permissions(request.data.get("lead_permissions"), TEAM_PERMISSION_SCOPES)
            if error:
                errors["lead_permissions"] = error
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                team.save()
                save_team_links(workspace, team, members, project_ids, lead_permissions)
        except IntegrityError:
            return Response({"name": "A team with this name already exists."}, status=status.HTTP_400_BAD_REQUEST)
        schedule_project_access_sync(workspace.id)
        return Response(teams_payload(workspace, [team])[0], status=status.HTTP_200_OK)

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def delete(self, request, slug, pk):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        team = Team.objects.filter(workspace=workspace, pk=pk).first()
        if not team:
            return Response({"error": "Team not found."}, status=status.HTTP_404_NOT_FOUND)
        with transaction.atomic():
            TeamMember.objects.filter(team=team).delete(soft=False)
            ProjectTeam.objects.filter(team=team).delete(soft=False)
            TeamPermission.objects.filter(team=team).delete(soft=False)
            AccessGrant.objects.filter(team=team).delete(soft=False)
            team.delete(soft=False)
        schedule_project_access_sync(workspace.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- check access


class CheckAccessEndpoint(BaseAPIView):
    """What one person may do and see, and why (their roles and teams)."""

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def get(self, request, slug, member_id):
        workspace = Workspace.objects.get(slug=slug)
        if not can_manage_access(request.user, workspace):
            return forbidden()
        membership = (
            WorkspaceMember.objects.filter(workspace=workspace, member_id=member_id, is_active=True)
            .select_related("member")
            .first()
        )
        if not membership:
            return Response({"error": "Pick a member of this workspace."}, status=status.HTTP_404_NOT_FOUND)
        profile = AccessProfile.load(membership.member, workspace.id)
        held = list(
            UserRole.objects.filter(workspace=workspace, member_id=member_id).values_list("role__name", flat=True)
        )
        projects = Project.objects.filter(workspace=workspace, archived_at__isnull=True)

        def project_names(action):
            return sorted(projects.filter(profile.project_q(action)).values_list("name", flat=True))

        team_names = dict(Team.objects.filter(pk__in=profile.led_team_ids).values_list("id", "name"))

        return Response(
            {
                "member_id": str(member_id),
                "is_rbac_enabled": workspace.is_rbac_enabled,
                "is_workspace_admin": profile.is_admin,
                "roles": held or ["No role yet: no projects until one is given"],
                "teams": [
                    {"name": name, "is_lead": is_lead}
                    for name, is_lead in TeamMember.objects.filter(
                        workspace=workspace, member_id=member_id
                    ).values_list("team__name", "is_lead")
                ],
                "permissions": {
                    module: {action: sorted(profile.scopes(module, action)) for action in RBAC_ACTIONS}
                    for module in RBAC_MODULES
                },
                # module -> action -> the teams whose Lead permissions it comes from (instead of the roles)
                "team_permissions": {
                    module: {
                        action: sorted(team_names[team_id] for team_id in team_ids)
                        for action, team_ids in actions.items()
                    }
                    for module, actions in profile.team_permission_team_ids.items()
                },
                "projects": {"view": project_names("view"), "edit": project_names("edit")},
            },
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------- project sharing


def can_share(user, workspace, project_id):
    """Whoever may edit the project (by role with RBAC on, as its admin otherwise), and access managers."""
    if can_manage_access(user, workspace):
        return True
    if workspace.is_rbac_enabled:
        return AccessProfile.load(user, workspace.id).can_on_project_id("edit", project_id)
    return ProjectMember.objects.filter(
        project_id=project_id, member=user, role=ROLE.ADMIN.value, is_active=True
    ).exists()


def serialize_grant(grant):
    return {
        "id": str(grant.id),
        "member_id": str(grant.member_id) if grant.member_id else None,
        "team_id": str(grant.team_id) if grant.team_id else None,
        "level": grant.level,
        "expires_at": grant.expires_at,
    }


class ProjectAccessEndpoint(BaseAPIView):
    """A project's owning teams and its shares (project settings, Access)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, project_id):
        workspace = Workspace.objects.get(slug=slug)
        project = Project.objects.filter(workspace=workspace, pk=project_id).first()
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "is_rbac_enabled": workspace.is_rbac_enabled,
                "can_share": can_share(request.user, workspace, project_id),
                "teams": [
                    {"id": str(team_id), "name": name}
                    for team_id, name in ProjectTeam.objects.filter(project=project).values_list(
                        "team_id", "team__name"
                    )
                ],
                "grants": [serialize_grant(g) for g in AccessGrant.objects.filter(project=project)],
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def post(self, request, slug, project_id):
        workspace = Workspace.objects.get(slug=slug)
        project = Project.objects.filter(workspace=workspace, pk=project_id).first()
        if not project:
            return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
        if not can_share(request.user, workspace, project_id):
            return Response(
                {"error": "Only people who may edit this project can share it."}, status=status.HTTP_403_FORBIDDEN
            )
        member_id, team_id = _uuid(request.data.get("member_id")), _uuid(request.data.get("team_id"))
        level = request.data.get("level", "view")
        errors = {}
        if bool(member_id) == bool(team_id):
            errors["error"] = "Share with one person or one team."
        elif member_id and member_id not in active_member_ids(workspace):
            errors["member_id"] = "Pick a member of this workspace."
        elif team_id and not Team.objects.filter(workspace=workspace, pk=team_id).exists():
            errors["team_id"] = "Pick a team of this workspace."
        if level not in GRANT_LEVELS:
            errors["level"] = "Pick view or manage."
        expires_at = None
        if request.data.get("expires_at"):
            expires_at = parse_datetime(str(request.data.get("expires_at")))
            if expires_at is None:
                errors["expires_at"] = "Send the end date as an ISO date and time."
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                grant = AccessGrant.objects.create(
                    workspace=workspace,
                    project=project,
                    member_id=member_id,
                    team_id=team_id,
                    level=level,
                    expires_at=expires_at,
                )
        except IntegrityError:
            return Response(
                {"error": "This project is already shared with them. Remove that share first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        schedule_project_access_sync(workspace.id)
        return Response(serialize_grant(grant), status=status.HTTP_201_CREATED)


class ProjectAccessGrantDetailEndpoint(BaseAPIView):
    @allow_permission(WORKSPACE_ROLES, level="WORKSPACE")
    def delete(self, request, slug, project_id, pk):
        workspace = Workspace.objects.get(slug=slug)
        if not can_share(request.user, workspace, project_id):
            return Response(
                {"error": "Only people who may edit this project can share it."}, status=status.HTTP_403_FORBIDDEN
            )
        grant = AccessGrant.objects.filter(workspace=workspace, project_id=project_id, pk=pk).first()
        if not grant:
            return Response({"error": "Share not found."}, status=status.HTTP_404_NOT_FOUND)
        grant.delete(soft=False)
        schedule_project_access_sync(workspace.id)
        return Response(status=status.HTTP_204_NO_CONTENT)
