# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Role-based access: the rules engine (step 2 of the RBAC plan).

`AccessProfile.load(user, workspace_id)` works out once what a person may do in a workspace; its methods answer
"may they do this?" and "which records does it reach?" as database filters. Nothing calls it yet: the next steps
plug it into the API, and only for workspaces with `Workspace.is_rbac_enabled` on.

Who gets what
  * Workspace admins: everything (they also keep role management, so nobody can be locked out).
  * Everyone else: what their roles grant, added up (two roles = the actions and records of both). People without
    a role see no projects, work items or reports until one is given; they keep their own tickets.
  * A team's leads: where the team sets Lead permissions (plane.db.models.rbac.TeamPermission), that setting replaces
    what their roles grant for the action, more or less ("none" = not allowed); leading several teams adds them up.

Scopes (plane.db.models.rbac.RBAC_SCOPES) per kind of record
  Work items
    own     assigned to me, or unassigned and created by me
    member  own + every work item in the projects I'm a member of
    team    own + work items assigned to members of the teams I lead (in any project) + in my team projects the
            work items no team claims (unassigned, or assigned only to people in no team). A work item assigned to
            another team's member stays theirs, also in a project two teams share.
    all     every work item
    A task assigned to a group (plane.db.models.member_group) has no assignees, so the rules above treat it as
    unassigned; on top of that everyone in the group may see it (only see: own = view), and team also reaches the
    group tasks of the people in the teams I lead.
  Projects
    own     created by me
    member  projects I'm a member of
    team    owned by the teams I lead + shared with me or my teams to manage; for viewing also the projects shared
            to view and the ones I'm a member of (membership alone never lets a PM change a project)
    all     every project, except that private projects stay with their members, their teams' PMs and people who
            may edit every project (HR, admins)
"""

# Python imports
from dataclasses import dataclass, field

# Django imports
from django.db.models import Exists, OuterRef, Q

ROLE_ADMIN = 20
ROLE_MEMBER = 15
ROLE_GUEST = 5
SECRET_NETWORK = 0


@dataclass
class AccessProfile:
    user_id: object
    workspace_id: object
    is_admin: bool = False
    # holds at least one role (without one: only their own tickets, see NO_ROLE_PERMISSIONS)
    has_role: bool = False
    # module -> action -> the scopes the person's roles grant for it (or the teams they lead, see below)
    permissions: dict = field(default_factory=dict)
    # module -> action -> the teams I lead whose Lead permissions replaced my roles' for it
    team_permission_team_ids: dict = field(default_factory=dict)
    led_team_ids: set = field(default_factory=set)
    team_ids: set = field(default_factory=set)
    # people in the teams I lead (me included)
    led_member_ids: set = field(default_factory=set)
    member_project_ids: set = field(default_factory=set)
    # guest memberships the sync raised to Member (for a group task): still no creating work items there
    raised_guest_project_ids: set = field(default_factory=set)
    led_project_ids: set = field(default_factory=set)
    # the groups I'm in, and the projects their tasks are in
    group_ids: set = field(default_factory=set)
    group_project_ids: set = field(default_factory=set)
    # shared with me or a team I'm in: view-only and manage
    view_grant_project_ids: set = field(default_factory=set)
    manage_grant_project_ids: set = field(default_factory=set)

    # ------------------------------------------------------------ loading

    @classmethod
    def load(cls, user, workspace_id):
        """Everything the rules need about `user` in one workspace, in a handful of queries."""
        from plane.db.models import (
            AccessGrant,
            Issue,
            MemberGroupMember,
            ProjectMember,
            ProjectTeam,
            RolePermission,
            TeamMember,
            TeamPermission,
            UserRole,
            WorkspaceMember,
        )
        from plane.db.models.rbac import NO_ROLE_PERMISSIONS

        profile = cls(user_id=user.id, workspace_id=workspace_id)
        profile.is_admin = WorkspaceMember.objects.filter(
            workspace_id=workspace_id, member_id=user.id, role=ROLE_ADMIN, is_active=True
        ).exists()

        role_ids = list(
            UserRole.objects.filter(
                workspace_id=workspace_id, member_id=user.id, role__deleted_at__isnull=True
            ).values_list("role_id", flat=True)
        )
        profile.has_role = bool(role_ids)
        if role_ids:
            for module, action, scope in RolePermission.objects.filter(role_id__in=role_ids).values_list(
                "module", "action", "scope"
            ):
                profile.permissions.setdefault(module, {}).setdefault(action, set()).add(scope)
        else:
            # no role yet: nothing but their own tickets (no projects at all) until someone gives them one
            for module, actions in NO_ROLE_PERMISSIONS.items():
                for action, scope in actions.items():
                    profile.permissions.setdefault(module, {}).setdefault(action, set()).add(scope)

        for team_id, is_lead in TeamMember.objects.filter(
            workspace_id=workspace_id, member_id=user.id, team__deleted_at__isnull=True
        ).values_list("team_id", "is_lead"):
            profile.team_ids.add(team_id)
            if is_lead:
                profile.led_team_ids.add(team_id)
        # what the teams I lead set for their leads replaces what my roles grant for that action (several teams add up)
        if profile.has_role and profile.led_team_ids:
            replaced = {}
            for team_id, module, action, scope in TeamPermission.objects.filter(
                team_id__in=profile.led_team_ids
            ).values_list("team_id", "module", "action", "scope"):
                replaced.setdefault((module, action), set()).add(scope)
                profile.team_permission_team_ids.setdefault(module, {}).setdefault(action, set()).add(team_id)
            for (module, action), scopes in replaced.items():
                profile.permissions.setdefault(module, {})[action] = scopes - {"none"}
        profile.led_member_ids = set(
            TeamMember.objects.filter(team_id__in=profile.led_team_ids).values_list("member_id", flat=True)
        )
        profile.led_project_ids = set(
            ProjectTeam.objects.filter(team_id__in=profile.led_team_ids).values_list("project_id", flat=True)
        )
        # memberships people were given, not the ones the sync made from these rules (they'd feed back into them)
        profile.member_project_ids = set(
            ProjectMember.objects.filter(
                workspace_id=workspace_id, member_id=user.id, is_active=True, rbac_managed=False
            ).values_list("project_id", flat=True)
        )
        profile.raised_guest_project_ids = set(
            ProjectMember.objects.filter(
                workspace_id=workspace_id,
                member_id=user.id,
                is_active=True,
                rbac_managed=False,
                rbac_original_role=ROLE_GUEST,
            ).values_list("project_id", flat=True)
        )
        profile.group_ids = set(
            MemberGroupMember.objects.filter(
                workspace_id=workspace_id, member_id=user.id, group__deleted_at__isnull=True
            ).values_list("group_id", flat=True)
        )
        if profile.group_ids:
            profile.group_project_ids = set(
                Issue.all_objects.filter(
                    workspace_id=workspace_id,
                    assignee_group_id__in=profile.group_ids,
                    deleted_at__isnull=True,
                    is_draft=False,
                ).values_list("project_id", flat=True)
            )
        for project_id, level in (
            AccessGrant.objects.active()
            .filter(workspace_id=workspace_id)
            .filter(Q(member_id=user.id) | Q(team_id__in=profile.team_ids))
            .values_list("project_id", "level")
        ):
            (profile.manage_grant_project_ids if level == "manage" else profile.view_grant_project_ids).add(project_id)
        return profile

    # ------------------------------------------------------------ permissions

    def scopes(self, module, action):
        """The scopes the person has for `action` on `module`; empty = not allowed."""
        if self.is_admin:
            return {"all"}
        return self.permissions.get(module, {}).get(action, set())

    def can(self, module, action):
        """Allowed at all (somewhere)? For buttons and for actions that aren't about one record."""
        return bool(self.scopes(module, action))

    # ------------------------------------------------------------ projects

    def team_project_ids(self, action):
        """Projects in my team scope for `action`: my teams' and the ones shared with me to manage; for viewing also
        the ones shared to view and the ones I'm a member of. Being a member alone never lets me change a project."""
        if action == "view":
            return (
                self.led_project_ids
                | self.manage_grant_project_ids
                | self.view_grant_project_ids
                | self.member_project_ids
            )
        return self.led_project_ids | self.manage_grant_project_ids

    def project_q(self, action):
        """Filter on Project: the projects `action` reaches. Q(pk__in=[]) when it reaches none."""
        scopes = self.scopes("projects", action)
        if "all" in scopes:
            if self.is_admin or "all" in self.scopes("projects", "edit"):
                return Q()
            # private projects stay with their members, their teams' PMs and whoever may edit every project
            return ~Q(network=SECRET_NETWORK) | Q(pk__in=self.team_project_ids("view") | self._group_view_ids(action))
        q = Q(pk__in=list(self._group_view_ids(action)))
        if "own" in scopes:
            q |= Q(created_by_id=self.user_id)
        if "member" in scopes:
            q |= Q(pk__in=self.member_project_ids)
        if "team" in scopes:
            q |= Q(pk__in=self.team_project_ids(action))
        return q

    def _group_view_ids(self, action):
        """Viewing reaches the projects my groups' tasks are in, so I can open those tasks."""
        return self.group_project_ids if action == "view" and self.scopes("projects", "view") else set()

    def can_on_project(self, action, project):
        """May the person do `action` on this project?"""
        return self.can_on_project_id(action, project.pk)

    def can_on_project_id(self, action, project_id):
        from plane.db.models import Project

        if not self.scopes("projects", action):
            return False
        return Project.objects.filter(pk=project_id).filter(self.project_q(action)).exists()

    # ------------------------------------------------------------ modules that live in projects

    def can_in_project(self, module, action, project_id):
        """May the person do `action` on `module` (milestones, ...) in this project? Own and Member mean "a project
        I'm a member of", Team "a project in my team scope", All anywhere."""
        scopes = self.scopes(module, action)
        if "all" in scopes:
            return True
        if "team" in scopes and project_id in self.team_project_ids(action):
            return True
        return bool(scopes & {"own", "member"}) and project_id in self.member_project_ids

    def module_project_ids(self, module, action):
        """The projects where `action` on `module` is allowed: None for every project."""
        scopes = self.scopes(module, action)
        if "all" in scopes:
            return None
        ids = set()
        if "team" in scopes:
            ids |= self.team_project_ids(action)
        if scopes & {"own", "member"}:
            ids |= self.member_project_ids
        return ids

    # ------------------------------------------------------------ employees and members

    def member_ids(self, action):
        """The workspace members `action` on Employees and members reaches: None for everyone. own = myself, member =
        the people in the projects I'm a member of, team = the people in the teams I lead (me included)."""
        from plane.db.models import ProjectMember

        scopes = self.scopes("members", action)
        if "all" in scopes:
            return None
        ids = {self.user_id} if scopes else set()
        if "member" in scopes:
            ids |= set(
                ProjectMember.objects.filter(
                    project_id__in=self.member_project_ids, is_active=True, member__isnull=False
                ).values_list("member_id", flat=True)
            )
        if "team" in scopes:
            ids |= self.led_member_ids
        return ids

    # ------------------------------------------------------------ worklogs

    def worklog_q(self, action):
        """Filter on IssueWorkLog, like work items: own = logged by me; member = in my projects; team = mine, my team
        members', and in my team projects the time of people in no team; all = everyone's."""
        from plane.db.models import TeamMember

        scopes = self.scopes("worklogs", action)
        if "all" in scopes:
            return Q()
        q = Q(pk__in=[])
        if scopes:
            q |= Q(logged_by_id=self.user_id)
        if "member" in scopes:
            q |= Q(project_id__in=self.member_project_ids)
        if "team" in scopes:
            in_teams = TeamMember.objects.filter(workspace_id=self.workspace_id).values("member_id")
            q |= Q(logged_by_id__in=self.led_member_ids) | (
                Q(project_id__in=self.team_project_ids(action)) & ~Q(logged_by_id__in=in_teams)
            )
        return q

    # ------------------------------------------------------------ work items

    def _work_item_scope_q(self, scope, action):
        from plane.db.models import IssueAssignee, TeamMember
        from plane.db.models.member_group import groups_of

        assignees = IssueAssignee.all_objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
        own = Exists(assignees.filter(assignee_id=self.user_id)) | (~Exists(assignees) & Q(created_by_id=self.user_id))
        if action == "view" and self.group_ids:
            own |= Q(assignee_group_id__in=self.group_ids)
        if scope == "own":
            return own
        if scope == "member":
            return own | Q(project_id__in=self.member_project_ids)
        if scope == "team":
            in_teams = TeamMember.objects.filter(workspace_id=self.workspace_id).values("member_id")
            claimed = Exists(assignees.filter(assignee_id__in=in_teams))
            return (
                own
                | Exists(assignees.filter(assignee_id__in=self.led_member_ids))
                | Q(assignee_group_id__in=groups_of(self.led_member_ids))
                | (Q(project_id__in=self.team_project_ids(action)) & ~claimed)
            )
        return Q()

    def work_item_q(self, action):
        """Filter on Issue: the work items `action` reaches. Q(pk__in=[]) when it reaches none."""
        scopes = self.scopes("work_items", action)
        if "all" in scopes:
            return Q()
        q = Q(pk__in=[])
        for scope in scopes:
            q |= self._work_item_scope_q(scope, action)
        return q

    def can_on_work_item(self, action, issue):
        """May the person view / edit / delete this work item?"""
        from plane.db.models import Issue

        if not self.scopes("work_items", action):
            return False
        return Issue.all_objects.filter(pk=issue.pk).filter(self.work_item_q(action)).exists()

    def can_create_work_item(self, project_id):
        """May the person create a work item in this project? Own and Member mean "a project I'm a member of"."""
        scopes = self.scopes("work_items", "create")
        if "all" in scopes:
            return True
        if "team" in scopes and project_id in self.team_project_ids("create"):
            return True
        return bool(scopes & {"own", "member"}) and project_id in self.create_member_project_ids

    @property
    def create_member_project_ids(self):
        """My projects for creating work items: not the guest memberships raised only for a group task."""
        return self.member_project_ids - self.raised_guest_project_ids


def is_rbac_enabled(workspace_id):
    """Whether role-based access applies in this workspace yet."""
    from plane.db.models import Workspace

    return Workspace.objects.filter(pk=workspace_id, is_rbac_enabled=True).exists()


def access_for(request, workspace_id):
    """The AccessProfile of the request's user, worked out once per request and workspace."""
    cache = request.__dict__.setdefault("_rbac_profiles", {})
    key = str(workspace_id)
    if key not in cache:
        cache[key] = AccessProfile.load(request.user, workspace_id)
    return cache[key]


def rbac_profile(request, slug):
    """The request user's AccessProfile in workspace `slug`, or None when role-based access is off there."""
    from plane.db.models import Workspace

    workspace_id = Workspace.objects.filter(slug=slug, is_rbac_enabled=True).values_list("id", flat=True).first()
    return access_for(request, workspace_id) if workspace_id else None


def pm_ids(workspace_id, member_id):
    """A person's PMs: the leads of the teams they're in (never themselves). They decide the person's requests to
    join projects."""
    from plane.db.models import TeamMember

    team_ids = TeamMember.objects.filter(
        workspace_id=workspace_id, member_id=member_id, team__deleted_at__isnull=True
    ).values("team_id")
    return set(
        TeamMember.objects.filter(team_id__in=team_ids, is_lead=True)
        .exclude(member_id=member_id)
        .values_list("member_id", flat=True)
    )


# ---------------------------------------------------------------- project memberships


def desired_project_roles(workspace_id):
    """(project_id, user_id) -> the project role role-based access gives: Admin where people may edit a project
    (HR everywhere, PMs in their team projects and manage shares), Guest where a project is only shared to view.

    Workspace admins and workspace guests are left to Plane's own rules; Employees get nothing here (they see
    projects through the project list and join them as guests), except Member where a task of their group is (Plane
    hides other people's work items from guests; this membership doesn't let them create work items there).
    """
    from plane.db.models import MemberGroupMember, Project, User, WorkspaceMember

    projects = Project.objects.filter(workspace_id=workspace_id, archived_at__isnull=True)
    people = User.objects.filter(
        pk__in=WorkspaceMember.objects.filter(workspace_id=workspace_id, is_active=True, role=ROLE_MEMBER).values(
            "member_id"
        )
    )
    group_projects = {}
    for project_id, member_id in (
        MemberGroupMember.objects.filter(
            workspace_id=workspace_id,
            group__deleted_at__isnull=True,
            group__assigned_issues__deleted_at__isnull=True,
            group__assigned_issues__is_draft=False,
            group__assigned_issues__project__archived_at__isnull=True,
            group__assigned_issues__project__deleted_at__isnull=True,
        )
        .values_list("group__assigned_issues__project_id", "member_id")
        .distinct()
    ):
        group_projects.setdefault(member_id, set()).add(project_id)
    desired = {}
    for user in people:
        profile = AccessProfile.load(user, workspace_id)
        edit_ids = set(projects.filter(profile.project_q("edit")).values_list("id", flat=True))
        view_ids = set(projects.filter(pk__in=profile.view_grant_project_ids).values_list("id", flat=True))
        for project_id in edit_ids:
            desired[(project_id, user.id)] = ROLE_ADMIN
        for project_id in view_ids - edit_ids:
            desired[(project_id, user.id)] = ROLE_GUEST
        if profile.scopes("work_items", "view"):
            for project_id in group_projects.get(user.id, ()):
                if desired.get((project_id, user.id), 0) < ROLE_MEMBER:
                    desired[(project_id, user.id)] = ROLE_MEMBER
    return desired


def sync_project_access(workspace_id):
    """Makes project memberships match role-based access, so everything in Plane that goes by membership follows.

    * Missing memberships are created (marked `rbac_managed`), and removed again when the access ends.
    * A hand-made membership is never removed; if its role is too low it is raised and its old role kept in
      `rbac_original_role`, then restored when the access ends.
    * With role-based access off, every change the sync made is undone.
    """
    from plane.db.models import ProjectMember, ProjectUserProperty, Workspace

    enabled = Workspace.objects.filter(pk=workspace_id, is_rbac_enabled=True).exists()
    desired = desired_project_roles(workspace_id) if enabled else {}
    rows = {
        (row.project_id, row.member_id): row
        for row in ProjectMember.objects.filter(workspace_id=workspace_id, member__isnull=False)
    }
    changed = []
    created = 0
    for key, role in desired.items():
        row = rows.get(key)
        if row is None:
            created += 1
            ProjectMember.objects.create(
                workspace_id=workspace_id,
                project_id=key[0],
                member_id=key[1],
                role=role,
                rbac_managed=True,
            )
            ProjectUserProperty.objects.get_or_create(workspace_id=workspace_id, project_id=key[0], user_id=key[1])
        elif row.rbac_managed or not row.is_active:
            # the sync's own membership, or one the person left: the sync manages it from now on
            if (row.role, row.is_active, row.rbac_managed) != (role, True, True):
                row.role, row.is_active, row.rbac_managed = role, True, True
                changed.append(row)
        elif row.role < role:
            if row.rbac_original_role is None:
                row.rbac_original_role = row.role
            row.role = role
            changed.append(row)
    for key, row in rows.items():
        if key in desired:
            continue
        if row.rbac_managed and row.is_active:
            row.is_active = False
            changed.append(row)
        elif not row.rbac_managed and row.rbac_original_role is not None:
            row.role, row.rbac_original_role = row.rbac_original_role, None
            changed.append(row)
    if changed:
        ProjectMember.objects.bulk_update(changed, ["role", "is_active", "rbac_managed", "rbac_original_role"])
    # memberships added, changed or ended
    return created + len(changed)
