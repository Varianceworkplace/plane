# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Role-based access: the data model (step 1 of the RBAC plan).

  * A workspace has roles. HR, Project Manager and Employee are built in (created for every workspace) and can be
    edited, never deleted; admins can add their own.
  * A role grants actions on modules, each with a scope: which records the action reaches. No row = not allowed.
  * People hold roles (several at once: what they grant adds up), belong to teams (as Lead, i.e. the PM, or
    Member), teams own projects (several teams can share one), and a project can be shared with a person or team.
  * A team can change what its leads may do (TeamPermission): its setting replaces their roles' for that action.
  * Nothing here changes what anyone can see or do yet: that comes with the rules engine, and only for workspaces
    with `Workspace.is_rbac_enabled` on.
"""

# Django imports
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

# Module imports
from ..mixins import SoftDeletionManager, SoftDeletionQuerySet
from .base import BaseModel

# module key -> label, in the order the role editor lists them
RBAC_MODULES = {
    "projects": "Projects",
    "work_items": "Work items",
    "milestones": "Milestones",
    "worklogs": "Worklogs and reports",
    "members": "Employees and members",
    "tickets": "Tickets",
    "analytics": "Analytics and dashboards",
    "teams": "Teams",
    "groups": "Groups",
    "role_management": "Role management",
}
RBAC_ACTIONS = ["view", "create", "edit", "delete"]
# Which records an action reaches, narrowest first:
#   own    - mine: assigned to me (tickets, worklogs: mine as creator / logger; members: my own profile)
#   member - in projects I'm a member of
#   team   - in projects owned by teams I lead or shared with me or my teams, plus my team members' work items
#   all    - the whole workspace
# Groups (Workspace settings › Groups) know only two: All = every group, any other scope = the groups I created.
RBAC_SCOPES = ["own", "member", "team", "all"]
# A team's setting for its leads (TeamPermission) replaces their roles' for that action, so it can also take it away
TEAM_PERMISSION_SCOPES = RBAC_SCOPES + ["none"]
GRANT_LEVELS = ["view", "manage"]

ALL = {action: "all" for action in RBAC_ACTIONS}
TEAM = {action: "team" for action in RBAC_ACTIONS}
OWN_TICKETS = {"view": "own", "create": "own", "edit": "own"}  # tickets can't be deleted
# PMs see every group and manage the ones they created
OWN_GROUPS = {"view": "all", "create": "own", "edit": "own", "delete": "own"}
# A member nobody has given a role yet: no projects, work items or reports until they get one. Tickets keep their own
# creator / assignee rules, so everyone can still raise and follow their own.
NO_ROLE_PERMISSIONS = {"tickets": OWN_TICKETS}

# The built-in roles: key -> (name, description, {module: {action: scope}}). Defaults only; editable per workspace.
SYSTEM_ROLES = {
    "hr": (
        "HR",
        "Sees and manages projects, work items and people across the workspace, and manages roles.",
        {
            "projects": ALL,
            "work_items": ALL,
            "milestones": ALL,
            "worklogs": {"view": "all", "create": "own", "edit": "own"},
            "members": ALL,
            "tickets": OWN_TICKETS,
            "analytics": {"view": "all"},
            "teams": ALL,
            "groups": ALL,
            "role_management": ALL,
        },
    ),
    "pm": (
        "Project Manager",
        "Manages the projects of the teams they lead and sees their team members' work items.",
        {
            "projects": TEAM,
            "work_items": TEAM,
            # every project's milestones are visible to everyone (of the projects they can see)
            "milestones": {**TEAM, "view": "all"},
            "worklogs": {"view": "team", "create": "own", "edit": "own"},
            # edit = switch their team members between Member and Guest (Workspace settings › Members)
            "members": {"view": "team", "edit": "team"},
            "tickets": OWN_TICKETS,
            "analytics": {"view": "team"},
            "teams": {"view": "team"},
            "groups": OWN_GROUPS,
        },
    ),
    "employee": (
        "Employee",
        "Views projects, sees only the work items assigned to them and can create work items in their projects.",
        {
            "projects": {"view": "all"},
            "work_items": {"view": "own", "create": "member", "edit": "own"},
            "milestones": {"view": "all"},
            "worklogs": {"view": "own", "create": "own", "edit": "own"},
            "members": {"view": "own"},
            "tickets": OWN_TICKETS,
            "analytics": {"view": "own"},
        },
    ),
}


def seed_system_roles(role_model, permission_model, workspace_id):
    """Creates the built-in roles a workspace is missing, with their default permissions.

    Takes the model classes so the data migration can pass its historical ones. Roles that already exist are left
    as they are: an admin may have edited their permissions.
    """
    existing = set(
        role_model.objects.filter(workspace_id=workspace_id, deleted_at__isnull=True)
        .exclude(key="")
        .values_list("key", flat=True)
    )
    for key, (name, description, permissions) in SYSTEM_ROLES.items():
        if key in existing:
            continue
        role = role_model.objects.create(
            workspace_id=workspace_id, key=key, name=name, description=description, is_system=True
        )
        permission_model.objects.bulk_create(
            [
                permission_model(role_id=role.id, module=module, action=action, scope=scope)
                for module, actions in permissions.items()
                for action, scope in actions.items()
            ]
        )


class Role(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="rbac_roles")
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default="")
    # "hr" / "pm" / "employee" for the built-in roles, "" for the ones admins add
    key = models.CharField(max_length=32, blank=True, default="")
    is_system = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Role"
        verbose_name_plural = "Roles"
        db_table = "rbac_roles"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"],
                condition=models.Q(deleted_at__isnull=True),
                name="rbac_role_unique_name_per_workspace_when_deleted_at_null",
            ),
            models.UniqueConstraint(
                fields=["workspace", "key"],
                condition=models.Q(deleted_at__isnull=True) & ~models.Q(key=""),
                name="rbac_role_unique_key_per_workspace_when_deleted_at_null",
            ),
        ]

    def __str__(self):
        return f"{self.workspace_id} {self.name}"

    def delete(self, using=None, soft=True, *args, **kwargs):
        if self.is_system:
            raise ValidationError("Built-in roles can't be deleted.")
        if UserRole.objects.filter(role=self).exists():
            raise ValidationError("Roles that people still hold can't be deleted.")
        return super().delete(using=using, soft=soft, *args, **kwargs)


class RolePermission(BaseModel):
    """One action a role may take on one module, and the records it reaches. No row = not allowed."""

    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="permissions")
    module = models.CharField(max_length=50, choices=[(key, label) for key, label in RBAC_MODULES.items()])
    action = models.CharField(max_length=20, choices=[(action, action) for action in RBAC_ACTIONS])
    scope = models.CharField(max_length=20, choices=[(scope, scope) for scope in RBAC_SCOPES])

    class Meta:
        verbose_name = "Role Permission"
        verbose_name_plural = "Role Permissions"
        db_table = "rbac_role_permissions"
        ordering = ("module", "action")
        constraints = [
            models.UniqueConstraint(
                fields=["role", "module", "action"],
                condition=models.Q(deleted_at__isnull=True),
                name="rbac_permission_unique_action_per_role_when_deleted_at_null",
            ),
            models.CheckConstraint(condition=models.Q(action__in=RBAC_ACTIONS), name="rbac_permission_action_valid"),
            models.CheckConstraint(condition=models.Q(scope__in=RBAC_SCOPES), name="rbac_permission_scope_valid"),
        ]

    def __str__(self):
        return f"{self.role_id} {self.module}.{self.action}={self.scope}"


class UserRole(BaseModel):
    """A person holds a role in a workspace. Several roles add up."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="rbac_user_roles")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="assignments")
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rbac_roles")

    class Meta:
        verbose_name = "User Role"
        verbose_name_plural = "User Roles"
        db_table = "rbac_user_roles"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["role", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="rbac_user_role_unique_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.member_id} {self.role_id}"

    def save(self, *args, **kwargs):
        if self.role.workspace_id != self.workspace_id:
            raise ValidationError("The role belongs to another workspace.")
        super().save(*args, **kwargs)


class TeamMember(BaseModel):
    """A person in a team: its Lead (the PM; a team can have several) or a Member."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_members")
    team = models.ForeignKey("db.Team", on_delete=models.CASCADE, related_name="team_members")
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_memberships")
    is_lead = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Team Member"
        verbose_name_plural = "Team Members"
        db_table = "team_members"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["team", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="team_member_unique_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.team_id} {self.member_id}{' (lead)' if self.is_lead else ''}"

    def save(self, *args, **kwargs):
        if self.team.workspace_id != self.workspace_id:
            raise ValidationError("The team belongs to another workspace.")
        super().save(*args, **kwargs)


class ProjectTeam(BaseModel):
    """A team that owns a project. Several teams can own one project (shared work, several PMs)."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="project_teams")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="owning_teams")
    team = models.ForeignKey("db.Team", on_delete=models.CASCADE, related_name="owned_projects")

    class Meta:
        verbose_name = "Project Team"
        verbose_name_plural = "Project Teams"
        db_table = "project_teams"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["project", "team"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_team_unique_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.project_id} {self.team_id}"

    def save(self, *args, **kwargs):
        if self.team.workspace_id != self.workspace_id or self.project.workspace_id != self.workspace_id:
            raise ValidationError("The project and the team must belong to this workspace.")
        super().save(*args, **kwargs)


class TeamPermission(BaseModel):
    """What a team's leads may do instead of what their roles grant, for one action on one module (Access control ›
    Teams › Lead permissions). No row = their roles decide; "none" = not allowed."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_permissions")
    team = models.ForeignKey("db.Team", on_delete=models.CASCADE, related_name="lead_permissions")
    module = models.CharField(max_length=50, choices=[(key, label) for key, label in RBAC_MODULES.items()])
    action = models.CharField(max_length=20, choices=[(action, action) for action in RBAC_ACTIONS])
    scope = models.CharField(max_length=20, choices=[(scope, scope) for scope in TEAM_PERMISSION_SCOPES])

    class Meta:
        verbose_name = "Team Permission"
        verbose_name_plural = "Team Permissions"
        db_table = "rbac_team_permissions"
        ordering = ("module", "action")
        constraints = [
            models.UniqueConstraint(
                fields=["team", "module", "action"],
                condition=models.Q(deleted_at__isnull=True),
                name="rbac_team_permission_unique_action_per_team_when_deleted_at_null",
            ),
            models.CheckConstraint(
                condition=models.Q(action__in=RBAC_ACTIONS), name="rbac_team_permission_action_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(scope__in=TEAM_PERMISSION_SCOPES), name="rbac_team_permission_scope_valid"
            ),
        ]

    def __str__(self):
        return f"{self.team_id} {self.module}.{self.action}={self.scope}"

    def save(self, *args, **kwargs):
        if self.team.workspace_id != self.workspace_id:
            raise ValidationError("The team belongs to another workspace.")
        super().save(*args, **kwargs)


class AccessGrantQuerySet(SoftDeletionQuerySet):
    def active(self):
        """Grants that haven't expired."""
        return self.filter(models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=timezone.now()))


class AccessGrantManager(SoftDeletionManager):
    def get_queryset(self):
        return AccessGrantQuerySet(self.model, using=self._db).filter(deleted_at__isnull=True)

    def active(self):
        return self.get_queryset().active()


class AccessGrant(BaseModel):
    """A project shared with one person or one team: view only, or manage. Optionally until a date."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="access_grants")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="access_grants")
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="project_access_grants",
    )
    team = models.ForeignKey(
        "db.Team", on_delete=models.CASCADE, null=True, blank=True, related_name="project_access_grants"
    )
    level = models.CharField(max_length=20, choices=[(level, level) for level in GRANT_LEVELS], default="view")
    expires_at = models.DateTimeField(null=True, blank=True)

    objects = AccessGrantManager()

    class Meta:
        verbose_name = "Access Grant"
        verbose_name_plural = "Access Grants"
        db_table = "project_access_grants"
        ordering = ("-created_at",)
        constraints = [
            # shared with exactly one person or one team
            models.CheckConstraint(
                condition=(
                    models.Q(member__isnull=False, team__isnull=True)
                    | models.Q(member__isnull=True, team__isnull=False)
                ),
                name="access_grant_member_xor_team",
            ),
            models.CheckConstraint(condition=models.Q(level__in=GRANT_LEVELS), name="access_grant_level_valid"),
            models.UniqueConstraint(
                fields=["project", "member"],
                condition=models.Q(deleted_at__isnull=True, member__isnull=False),
                name="access_grant_unique_member_when_deleted_at_null",
            ),
            models.UniqueConstraint(
                fields=["project", "team"],
                condition=models.Q(deleted_at__isnull=True, team__isnull=False),
                name="access_grant_unique_team_when_deleted_at_null",
            ),
        ]

    def __str__(self):
        return f"{self.project_id} -> {self.member_id or self.team_id} ({self.level})"

    def save(self, *args, **kwargs):
        if self.project.workspace_id != self.workspace_id or (
            self.team_id and self.team.workspace_id != self.workspace_id
        ):
            raise ValidationError("The project and the team must belong to this workspace.")
        super().save(*args, **kwargs)


JOIN_REQUEST_STATUSES = ["pending", "approved", "rejected"]


class ProjectJoinRequest(BaseModel):
    """Someone asking to join a project while role-based access is on. Their PM (a lead of a team they're in)
    approves or rejects it; they're added to the project only once it's approved."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="project_join_requests")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="join_requests")
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_join_requests")
    status = models.CharField(
        max_length=20, choices=[(status, status) for status in JOIN_REQUEST_STATUSES], default="pending"
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="decided_project_join_requests",
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Project Join Request"
        verbose_name_plural = "Project Join Requests"
        db_table = "project_join_requests"
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=JOIN_REQUEST_STATUSES), name="project_join_request_status_valid"
            ),
            # one open request per person and project; once decided they may ask again
            models.UniqueConstraint(
                fields=["project", "member"],
                condition=models.Q(status="pending", deleted_at__isnull=True),
                name="project_join_request_one_pending",
            ),
        ]

    def __str__(self):
        return f"{self.member_id} -> {self.project_id} ({self.status})"


@receiver(post_save, sender="db.Workspace")
def create_system_roles(sender, instance, created, **kwargs):
    # every new workspace starts with the built-in roles (RBAC itself stays off until turned on)
    if created:
        seed_system_roles(Role, RolePermission, instance.id)


# ---------------------------------------------------------------- keeping project memberships in step


def schedule_project_access_sync(workspace_id):
    """Project memberships follow role-based access (plane.utils.rbac.sync_project_access), once the change is saved."""
    from plane.bgtasks.rbac_sync_task import sync_project_access_task

    transaction.on_commit(lambda: sync_project_access_task.delay(str(workspace_id)))


@receiver(post_save, sender=UserRole)
@receiver(post_delete, sender=UserRole)
@receiver(post_save, sender=TeamMember)
@receiver(post_delete, sender=TeamMember)
@receiver(post_save, sender=ProjectTeam)
@receiver(post_delete, sender=ProjectTeam)
@receiver(post_save, sender=TeamPermission)
@receiver(post_delete, sender=TeamPermission)
@receiver(post_save, sender=AccessGrant)
@receiver(post_delete, sender=AccessGrant)
def access_changed(sender, instance, **kwargs):
    schedule_project_access_sync(instance.workspace_id)


@receiver(post_save, sender=RolePermission)
@receiver(post_delete, sender=RolePermission)
def permission_changed(sender, instance, **kwargs):
    workspace_id = Role.all_objects.filter(pk=instance.role_id).values_list("workspace_id", flat=True).first()
    if workspace_id:
        schedule_project_access_sync(workspace_id)


@receiver(pre_save, sender="db.Workspace")
def remember_rbac_switch(sender, instance, **kwargs):
    instance._rbac_was_enabled = (
        sender.all_objects.filter(pk=instance.pk).values_list("is_rbac_enabled", flat=True).first()
        if instance.pk
        else None
    )


@receiver(post_save, sender="db.Workspace")
def rbac_switch_changed(sender, instance, created, **kwargs):
    if not created and getattr(instance, "_rbac_was_enabled", None) not in (None, instance.is_rbac_enabled):
        schedule_project_access_sync(instance.id)


@receiver(post_save, sender="db.Project")
def project_created(sender, instance, created, **kwargs):
    # HR and the PMs of its teams get access to a new project
    if created and not instance.is_ticket_project:
        schedule_project_access_sync(instance.workspace_id)
