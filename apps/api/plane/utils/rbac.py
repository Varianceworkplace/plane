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
  * Seniority in a team (TeamMember.level: Junior < Mid-level < Senior < the team's leads): people see the timesheets
    (worklogs) of the members below them in the same team, never another team's (AccessProfile.worklog_q).

Scopes (plane.db.models.rbac.RBAC_SCOPES) per kind of record
  Work items
    own     assigned to me, or unassigned and created by me
    member  own + every work item in the projects I'm a member of
    team    own + work items assigned to members of the teams I lead (in any project) + in my team projects the
            work items no team claims (unassigned, or assigned only to people in no team). A work item assigned to
            another team's member stays theirs, also in a project two teams share.
    all     every work item
    A task assigned to a team (Issue.assignee_team) has no assignees: everyone in the team works on it as if it
    were assigned to them (it is "own" for them), team also reaches the team tasks of the people in the teams I
    lead, and otherwise the rules above treat it as unassigned (its creator, the project's PMs).
  Projects
    own     created by me
    member  projects I'm a member of
    team    owned by the teams I lead + shared with me or my teams to manage; for viewing also the projects shared
            to view and the ones I'm a member of (membership alone never lets a PM change a project)
    all     every project, except that private projects stay with their members, their teams' PMs and people whose
            role grants editing All (HR, admins)
    Changing or deleting a project goes further, as in Variance's Workplace (vTiger): only its creator (if their
    role allows the action at all) and workspace admins, whatever scope the role sets. Everyone else works in a
    project as a member.

Team projects
  A project a team owns (Access control › Teams) or is assigned to (ProjectDetail.assigned_team, vTiger's "Assigned
  To" a team) is the team's: its leads (PMs) have it in their team scope, and its members are members of it (they
  see it, private or not, and create work items there). The projects of the tasks assigned to my teams are visible
  to me too, so I can open those tasks.
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
    # the built-in roles held ("hr", "pm", "employee"); roles admins added have no key
    role_keys: set = field(default_factory=set)
    # module -> action -> the scopes the person's roles grant for it (or the teams they lead, see below)
    permissions: dict = field(default_factory=dict)
    # module -> action -> the teams I lead whose Lead permissions replaced my roles' for it
    team_permission_team_ids: dict = field(default_factory=dict)
    led_team_ids: set = field(default_factory=set)
    team_ids: set = field(default_factory=set)
    # people in the teams I lead (me included)
    led_member_ids: set = field(default_factory=set)
    # people below me in the teams I'm in (TeamMember.level; a team's leads are above every level): I see their
    # timesheets
    junior_member_ids: set = field(default_factory=set)
    # the projects I'm a member of: the memberships people gave me and my teams' projects
    member_project_ids: set = field(default_factory=set)
    # guest memberships the sync raised to Member (for a team task): still no creating work items there
    raised_guest_project_ids: set = field(default_factory=set)
    # owned by or assigned to the teams I lead
    led_project_ids: set = field(default_factory=set)
    # owned by or assigned to a team I'm in: I work in them as a member
    team_work_project_ids: set = field(default_factory=set)
    # the projects of the tasks assigned to my teams
    team_task_project_ids: set = field(default_factory=set)
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
            ProjectDetail,
            ProjectMember,
            ProjectTeam,
            RolePermission,
            TeamMember,
            TeamPermission,
            UserRole,
            WorkspaceMember,
        )
        from plane.db.models.rbac import NO_ROLE_PERMISSIONS, TEAM_LEVEL_RANKS

        lead_rank = len(TEAM_LEVEL_RANKS) + 1  # a team's leads are above every level

        profile = cls(user_id=user.id, workspace_id=workspace_id)
        profile.is_admin = WorkspaceMember.objects.filter(
            workspace_id=workspace_id, member_id=user.id, role=ROLE_ADMIN, is_active=True
        ).exists()

        held = list(
            UserRole.objects.filter(
                workspace_id=workspace_id, member_id=user.id, role__deleted_at__isnull=True
            ).values_list("role_id", "role__key")
        )
        role_ids = [role_id for role_id, _ in held]
        profile.role_keys = {key for _, key in held if key}
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

        my_ranks = {}
        for team_id, is_lead, level in TeamMember.objects.filter(
            workspace_id=workspace_id, member_id=user.id, team__deleted_at__isnull=True
        ).values_list("team_id", "is_lead", "level"):
            profile.team_ids.add(team_id)
            if is_lead:
                profile.led_team_ids.add(team_id)
            my_ranks[team_id] = lead_rank if is_lead else TEAM_LEVEL_RANKS.get(level, 1)
        # in each of my teams, the members at a lower level than mine (never another team's people)
        for team_id, member_id, level in (
            TeamMember.objects.filter(team_id__in=my_ranks, is_lead=False)
            .exclude(member_id=user.id)
            .values_list("team_id", "member_id", "level")
        ):
            if TEAM_LEVEL_RANKS.get(level, 1) < my_ranks[team_id]:
                profile.junior_member_ids.add(member_id)
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
        if profile.team_ids:
            owned = ProjectTeam.objects.filter(team_id__in=profile.team_ids).values_list("team_id", "project_id")
            assigned = ProjectDetail.objects.filter(
                workspace_id=workspace_id, assigned_team_id__in=profile.team_ids
            ).values_list("assigned_team_id", "project_id")
            for team_id, project_id in [*owned, *assigned]:
                profile.team_work_project_ids.add(project_id)
                if team_id in profile.led_team_ids:
                    profile.led_project_ids.add(project_id)
            profile.team_task_project_ids = set(
                Issue.all_objects.filter(
                    workspace_id=workspace_id,
                    assignee_team_id__in=profile.team_ids,
                    deleted_at__isnull=True,
                    is_draft=False,
                ).values_list("project_id", flat=True)
            )
        # memberships people were given, not the ones the sync made from these rules (they'd feed back into them)
        profile.member_project_ids = (
            set(
                ProjectMember.objects.filter(
                    workspace_id=workspace_id, member_id=user.id, is_active=True, rbac_managed=False
                ).values_list("project_id", flat=True)
            )
            | profile.team_work_project_ids
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

    @property
    def uses_own_project_list(self):
        """Project Managers' sidebar Projects list starts with only their own projects (plane.utils.project_list);
        HR and workspace admins keep every project in it."""
        return not self.is_admin and "pm" in self.role_keys and "hr" not in self.role_keys

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
        if action in ("edit", "delete"):
            # as in Workplace: only a project's creator (if their role allows the action at all) and workspace
            # admins change or delete it
            if self.is_admin:
                return Q()
            return Q(created_by_id=self.user_id) if scopes else Q(pk__in=[])
        if "all" in scopes:
            if self.is_admin or "all" in self.scopes("projects", "edit"):
                return Q()
            # private projects stay with their members, their teams' PMs and whoever may edit every project
            return ~Q(network=SECRET_NETWORK) | Q(
                pk__in=self.team_project_ids("view") | self._team_task_view_ids(action)
            )
        q = Q(pk__in=list(self._team_task_view_ids(action)))
        if "own" in scopes:
            q |= Q(created_by_id=self.user_id)
        if "member" in scopes:
            q |= Q(pk__in=self.member_project_ids)
        if "team" in scopes:
            q |= Q(pk__in=self.team_project_ids(action))
        return q

    def _team_task_view_ids(self, action):
        """Viewing reaches the projects my teams' tasks are in, so I can open those tasks."""
        return self.team_task_project_ids if action == "view" and self.scopes("projects", "view") else set()

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
        """Filter on IssueWorkLog: own = logged by me; member = in my projects; team = mine and the people's in the
        teams I lead (time is a person's: a team scope never reaches people outside my teams, also not in my team
        projects); all = everyone's.

        Viewing also reaches the time of the people below me in my teams (junior_member_ids), whatever my scope,
        as long as my roles let me view worklogs at all."""
        scopes = self.scopes("worklogs", action)
        if "all" in scopes:
            return Q()
        q = Q(pk__in=[])
        if scopes:
            q |= Q(logged_by_id=self.user_id)
        if scopes and action == "view" and self.junior_member_ids:
            q |= Q(logged_by_id__in=self.junior_member_ids)
        if "member" in scopes:
            q |= Q(project_id__in=self.member_project_ids)
        if "team" in scopes:
            q |= Q(logged_by_id__in=self.led_member_ids)
        return q

    def worklog_people_ids(self):
        """The people whose time I may see (worklog_q("view")), or None for everyone. People whose time I see only
        in some projects (Member scope) count once they have time there."""
        scopes = self.scopes("worklogs", "view")
        if "all" in scopes:
            return None
        ids = {self.user_id}
        if scopes:
            ids |= self.junior_member_ids
        if "team" in scopes:
            ids |= self.led_member_ids
        return ids

    # ------------------------------------------------------------ work items

    def _work_item_scope_q(self, scope, action):
        from plane.db.models import IssueAssignee, TeamMember
        from plane.db.models.rbac import teams_of

        assignees = IssueAssignee.all_objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
        own = Exists(assignees.filter(assignee_id=self.user_id)) | (~Exists(assignees) & Q(created_by_id=self.user_id))
        if self.team_ids:
            # a task assigned to my team is mine as well
            own |= Q(assignee_team_id__in=self.team_ids)
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
                | Q(assignee_team_id__in=teams_of(self.led_member_ids))
                | (Q(project_id__in=self.team_project_ids(action)) & ~claimed)
            )
        return Q()

    def work_item_q(self, action, module="work_items"):
        """Filter on Issue: the work items `action` reaches. Q(pk__in=[]) when it reaches none.

        `module` picks whose scopes apply: reports count work items by the Analytics permission instead."""
        scopes = self.scopes(module, action)
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
        """My projects for creating work items: my teams' projects and my memberships, but not the guest memberships
        raised only for a team task."""
        return (self.member_project_ids - self.raised_guest_project_ids) | self.team_work_project_ids


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


def team_assigned_project_roles(workspace_id):
    """(project_id, user_id) -> Member for everyone in the team a project or one of its tasks is assigned to, so they
    can work on it. Used while role-based access is off (with it on, desired_project_roles gives this and more)."""
    from plane.db.models import Issue, Project, ProjectDetail, TeamMember, WorkspaceMember

    live_projects = Project.objects.filter(workspace_id=workspace_id, archived_at__isnull=True).values("id")
    links = set(
        ProjectDetail.objects.filter(
            workspace_id=workspace_id, assigned_team__isnull=False, project_id__in=live_projects
        ).values_list("project_id", "assigned_team_id")
    ) | set(
        Issue.all_objects.filter(
            workspace_id=workspace_id,
            assignee_team__isnull=False,
            deleted_at__isnull=True,
            is_draft=False,
            project_id__in=live_projects,
        ).values_list("project_id", "assignee_team_id")
    )
    if not links:
        return {}
    members = WorkspaceMember.objects.filter(workspace_id=workspace_id, is_active=True, role=ROLE_MEMBER)
    team_members = {}
    for team_id, member_id in TeamMember.objects.filter(
        workspace_id=workspace_id, team__deleted_at__isnull=True, member_id__in=members.values("member_id")
    ).values_list("team_id", "member_id"):
        team_members.setdefault(team_id, set()).add(member_id)
    return {
        (project_id, member_id): ROLE_MEMBER
        for project_id, team_id in links
        for member_id in team_members.get(team_id, ())
    }


def desired_project_roles(workspace_id, profiles=None):
    """(project_id, user_id) -> the project role role-based access gives:

    * Admin in the projects people may change: the ones they created (see AccessProfile.project_q).
    * Member where their role lets them work on others' project tasks: every project they see for All (HR), their
      team projects for Team (PMs), and projects shared with them to manage.
    * Member in their teams' projects (owned by or assigned to a team they're in) and where a task of their team
      is (Plane hides other people's work items from guests; the latter doesn't let them create work items there).
    * Guest where a project is only shared to view.

    Workspace admins and workspace guests are left to Plane's own rules; Employees get nothing else here (they see
    projects through the project list and ask to join).

    `profiles` (user id -> AccessProfile) reuses profiles the caller already loaded; the others are loaded here.
    """
    from plane.db.models import Project, User, WorkspaceMember

    projects = Project.objects.filter(workspace_id=workspace_id, archived_at__isnull=True)
    live_ids = set(projects.values_list("id", flat=True))
    people = User.objects.filter(
        pk__in=WorkspaceMember.objects.filter(workspace_id=workspace_id, is_active=True, role=ROLE_MEMBER).values(
            "member_id"
        )
    )
    desired = {}

    def give(project_ids, user_id, role):
        for project_id in project_ids:
            if desired.get((project_id, user_id), 0) < role:
                desired[(project_id, user_id)] = role

    for user in people:
        profile = profiles.get(user.id) if profiles else None
        if profile is None:
            profile = AccessProfile.load(user, workspace_id)
        visible_ids = set(projects.filter(profile.project_q("view")).values_list("id", flat=True))
        work_scopes = profile.scopes("work_items", "create") | profile.scopes("work_items", "edit")
        if "all" in work_scopes:
            work_ids = set(visible_ids)
        elif "team" in work_scopes:
            work_ids = visible_ids & profile.team_project_ids("edit")
        else:
            work_ids = set()
        work_ids |= visible_ids & profile.manage_grant_project_ids
        give(projects.filter(pk__in=profile.view_grant_project_ids).values_list("id", flat=True), user.id, ROLE_GUEST)
        give(work_ids, user.id, ROLE_MEMBER)
        if profile.scopes("work_items", "view"):
            give(live_ids & (profile.team_work_project_ids | profile.team_task_project_ids), user.id, ROLE_MEMBER)
        give(projects.filter(profile.project_q("edit")).values_list("id", flat=True), user.id, ROLE_ADMIN)
    return desired


def sync_project_access(workspace_id):
    """Makes project memberships match role-based access, so everything in Plane that goes by membership follows.

    * Missing memberships are created (marked `rbac_managed`), and removed again when the access ends.
    * A hand-made membership is never removed; if its role is too low it is raised and its old role kept in
      `rbac_original_role`, then lowered again (never below that role) when the access shrinks or ends.
    * With role-based access off, every change the sync made is undone, except the membership that a project or
      a task assigned to a team gives the team's members (team_assigned_project_roles).
    """
    from plane.db.models import ProjectMember, ProjectUserProperty, Workspace

    enabled = Workspace.objects.filter(pk=workspace_id, is_rbac_enabled=True).exists()
    desired = desired_project_roles(workspace_id) if enabled else team_assigned_project_roles(workspace_id)
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
        elif row.rbac_original_role is not None and row.role > max(role, row.rbac_original_role):
            # raised by the sync before, to more than it gives now: lowered again, never below the person's own role
            row.role = max(role, row.rbac_original_role)
            if row.role == row.rbac_original_role:
                row.rbac_original_role = None
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
