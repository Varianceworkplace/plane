# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Disable, enable and permanently delete a workspace member (Access control › People).

* Disable: the person loses access everywhere at once. Their account is deactivated (sign-in refused with "User
  account deactivated", open sessions ended, API keys stop working) and their workspace membership becomes
  suspended, so pickers grey them out. Nothing else changes: their work, time, roles and teams stay, and Enable puts
  it all back.
* Delete (only once disabled): as in Workplace, the person's shared work goes to someone HR picks, the rest of what's
  theirs is deleted, and then the account itself. Every link the database has to a person is handled by a rule
  below (moved, merged, deleted, or emptied); a link without a rule stops the delete, so nothing is ever removed
  that wasn't meant to be.

Who may: workspace admins, and people whose roles let them delete Employees and members (HR); never on themselves,
the workspace owner or an instance admin, and only admins on another admin.
"""

# Python imports
from collections import defaultdict

# Django imports
from django.apps import apps
from django.db import models, transaction
from django.db.models import Sum
from django.utils import timezone

# Module imports
from plane.db.models import (
    DraftIssue,
    Issue,
    IssueAssignee,
    IssueComment,
    IssueWorkLog,
    IssueWorkLogTimer,
    Page,
    Project,
    ProjectMember,
    Session,
    TeamMember,
    User,
    UserRole,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
)
from plane.db.models.rbac import schedule_project_access_sync
from plane.license.models import InstanceAdmin
from plane.utils.rbac import AccessProfile

ROLE_ADMIN = 20
ROLE_GUEST = 5


class RemovalError(Exception):
    """A reason the action can't go ahead; `forbidden` for "you may not" (403), else "not now" (400)."""

    def __init__(self, message, forbidden=False):
        super().__init__(message)
        self.message = message
        self.forbidden = forbidden


# ------------------------------------------------------------------ what happens to each link on delete

# the person's own records: deleted with them
DELETE = {
    ("IssueWorkLog", "logged_by"),  # their time entries (HR's choice)
    ("IssueWorkLogTimer", "user"),
    ("Notification", "receiver"),
    ("EmailNotificationLog", "receiver"),
    ("EmailNotificationLog", "triggered_by"),
    ("UserFavorite", "user"),
    ("UserRecentVisit", "user"),
    ("UserNotificationPreference", "user"),
    ("WorkspaceUserProperties", "user"),
    ("WorkspaceUserPreference", "user"),
    ("WorkspaceHomePreference", "user"),
    ("ProjectUserProperty", "user"),
    ("CycleUserProperties", "user"),
    ("ModuleUserProperties", "user"),
    ("Sticky", "owner"),
    ("WorkspaceUserLink", "owner"),
    ("WorkspaceTheme", "actor"),
    ("IssueSubscriber", "subscriber"),
    ("IssueMention", "mention"),
    ("IssueReaction", "actor"),
    ("CommentReaction", "actor"),
    ("IssueVote", "actor"),
    ("ExporterHistory", "initiated_by"),
    ("APIToken", "user"),
    ("Device", "user"),
    ("SocialLoginConnection", "user"),
    ("Account", "user"),
    ("FileAsset", "user"),  # their avatar and cover
    ("WorkspaceMember", "member"),
    ("ProjectMember", "member"),
    ("ProjectPublicMember", "member"),
    ("TeamMember", "member"),
    ("UserRole", "member"),
    ("AccessGrant", "member"),
    ("ProjectJoinRequest", "member"),
    ("Profile", "user"),
}

# shared work: goes to the new owner
TRANSFER = {
    ("Project", "project_lead"),
    ("Project", "default_assignee"),
    ("Cycle", "owned_by"),
    ("Page", "owned_by"),
    ("PageVersion", "owned_by"),
    ("IssueComment", "actor"),
    ("IssueDescriptionVersion", "owned_by"),
    ("IssueVersion", "owned_by"),
    ("IssueActivity", "actor"),
    ("IssueView", "owned_by"),
    ("Module", "lead"),
    ("Milestone", "assigned_to"),
    ("Ticket", "manager"),
    ("Ticket", "approval_decided_by"),
    ("IssueTaskDetail", "requested_by"),
    ("ProjectJoinRequest", "decided_by"),
    ("Importer", "initiated_by"),
    ("WorkspaceIntegration", "actor"),
    ("GithubRepositorySync", "actor"),
}
# and who created or last changed anything (projects, tasks, tickets, ...): every model's created_by / updated_by
AUDIT_FIELDS = {"created_by", "updated_by"}

# assignments: go to the new owner, once per item (they may be on it already)
MERGE = {
    ("IssueAssignee", "assignee"): "issue",
    ("DraftIssueAssignee", "assignee"): "draft_issue",
    ("ModuleMember", "member"): "module",
}

# emptied when the account goes (Django's SET_NULL): "X did this" on other people's notifications
EMPTIED = {("Notification", "triggered_by")}

# refused before anything happens (check_can_act): workspace owners and instance admins are never deleted here
PRECHECKED = {("Workspace", "owner"), ("InstanceAdmin", "user")}


def _rows(model):
    """Every row, soft-deleted ones too: they still point at the person."""
    return getattr(model, "all_objects", model._default_manager)


def _person_links():
    """(model, field) for every foreign key or one-to-one to a person, in every model (each model's own fields,
    so none is missed: created_by and updated_by included)."""
    return [
        (model, field)
        for model in apps.get_models()
        if not model._meta.proxy
        for field in model._meta.concrete_fields
        if field.is_relation and (field.many_to_one or field.one_to_one) and field.related_model is User
    ]


# ------------------------------------------------------------------ who may act on whom


def check_can_act(actor, workspace, target_id, doing="disable or delete"):
    """Returns the target's WorkspaceMember, or raises RemovalError. `doing` words the refusals (the same rules decide
    who may reset someone's password)."""
    if target_id == actor.id:
        raise RemovalError(f"You can't {doing} yourself.")
    membership = (
        WorkspaceMember.objects.filter(workspace=workspace, member_id=target_id).select_related("member").first()
    )
    if membership is None or membership.member.is_bot:
        raise RemovalError("Pick a member of this workspace.")
    actor_is_admin = WorkspaceMember.objects.filter(
        workspace=workspace, member=actor, role=ROLE_ADMIN, is_active=True
    ).exists()
    if not actor_is_admin:
        reached = AccessProfile.load(actor, workspace.id).member_ids("delete")
        if reached is not None and target_id not in reached:
            raise RemovalError(f"Your role doesn't let you {doing} this person.", forbidden=True)
        if membership.role == ROLE_ADMIN:
            raise RemovalError(f"Only workspace admins can {doing} another admin.", forbidden=True)
    if Workspace.objects.filter(owner_id=target_id).exists():
        raise RemovalError("They own a workspace. Make someone else its owner first.")
    if InstanceAdmin.objects.filter(user_id=target_id).exists():
        raise RemovalError("They're an instance admin (God mode). Remove that first.")
    return membership


def removable_member_ids(actor, workspace):
    """The people the actor may disable or delete (People tab), or None for everyone but the protected ones."""
    if WorkspaceMember.objects.filter(workspace=workspace, member=actor, role=ROLE_ADMIN, is_active=True).exists():
        return None
    return AccessProfile.load(actor, workspace.id).member_ids("delete")


def protected_member_ids():
    """Never disabled or deleted here: workspace owners and instance admins."""
    return set(Workspace.objects.values_list("owner_id", flat=True)) | set(
        InstanceAdmin.objects.exclude(user_id=None).values_list("user_id", flat=True)
    )


# ------------------------------------------------------------------ disable / enable


def disable_member(actor, workspace, target_id):
    membership = check_can_act(actor, workspace, target_id)
    user = membership.member
    if not membership.is_active and not user.is_active:
        raise RemovalError("They're already disabled.")
    now = timezone.now()
    with transaction.atomic():
        WorkspaceMember.objects.filter(pk=membership.pk).update(is_active=False, updated_at=now, updated_by=actor)
        # sign-in then answers "User account deactivated" (the adapter checks last_logout_time)
        User.objects.filter(pk=user.pk).update(is_active=False, last_logout_time=now)
        # signed out everywhere, right now
        Session.objects.filter(user_id=str(user.pk)).delete()
        schedule_project_access_sync(workspace.id)


def enable_member(actor, workspace, target_id):
    membership = check_can_act(actor, workspace, target_id)
    if membership.is_active and membership.member.is_active:
        raise RemovalError("They're already active.")
    with transaction.atomic():
        WorkspaceMember.objects.filter(pk=membership.pk).update(
            is_active=True, updated_at=timezone.now(), updated_by=actor
        )
        User.objects.filter(pk=membership.member_id).update(is_active=True)
        schedule_project_access_sync(workspace.id)


# ------------------------------------------------------------------ delete


def _delete_blockers(workspace, membership):
    if membership.is_active:
        return "Disable them first."
    other = (
        WorkspaceMember.objects.filter(member_id=membership.member_id)
        .exclude(workspace=workspace)
        .values_list("workspace__name", flat=True)
        .first()
    )
    if other:
        return f"They're also in the workspace {other}. Remove them there first."
    return None


def deletion_summary(actor, workspace, target_id):
    """What deleting this person would do (the confirmation dialog), and who may take over their work."""
    membership = check_can_act(actor, workspace, target_id)
    uid = membership.member_id
    time = IssueWorkLog.objects.filter(logged_by_id=uid).aggregate(total=Sum("duration"))
    return {
        "member_id": str(uid),
        "blocker": _delete_blockers(workspace, membership),
        "transfer": {
            "projects_created": Project.objects.filter(created_by_id=uid).count(),
            "projects_led": Project.objects.filter(project_lead_id=uid).count(),
            "tasks_assigned": IssueAssignee.objects.filter(assignee_id=uid, issue__deleted_at__isnull=True).count(),
            "tasks_created": Issue.objects.filter(created_by_id=uid).count(),
            "comments": IssueComment.objects.filter(actor_id=uid).count(),
            "pages": Page.objects.filter(owned_by_id=uid).count(),
        },
        "delete": {
            "time_entries": IssueWorkLog.objects.filter(logged_by_id=uid).count(),
            "time_minutes": time["total"] or 0,
            "running_timer": IssueWorkLogTimer.objects.filter(user_id=uid).exists(),
            "drafts": DraftIssue.objects.filter(created_by_id=uid).count(),
            "project_memberships": ProjectMember.objects.filter(member_id=uid, is_active=True).count(),
            "teams": TeamMember.objects.filter(member_id=uid).count(),
            "roles": UserRole.objects.filter(member_id=uid).count(),
        },
        "transfer_to_ids": [
            str(member_id)
            for member_id in WorkspaceMember.objects.filter(
                workspace=workspace, is_active=True, member__is_active=True, member__is_bot=False
            )
            .exclude(member_id=uid)
            .values_list("member_id", flat=True)
        ],
    }


def _give_project_access(uid, new_owner, new_owner_role):
    """The new owner works where the person did: at least the person's project role there, so they can open what
    now is theirs and every project keeps an admin. A workspace guest stays a guest in projects, as in Plane."""
    for membership in _rows(ProjectMember).filter(member_id=uid, is_active=True, deleted_at__isnull=True):
        role = membership.role if new_owner_role > ROLE_GUEST else ROLE_GUEST
        existing = _rows(ProjectMember).filter(project_id=membership.project_id, member_id=new_owner.id).first()
        if existing is None:
            ProjectMember.objects.create(
                workspace_id=membership.workspace_id, project_id=membership.project_id, member=new_owner, role=role
            )
        elif existing.deleted_at is not None or not existing.is_active:
            _rows(ProjectMember).filter(pk=existing.pk).update(
                deleted_at=None, is_active=True, role=role, rbac_managed=False, rbac_original_role=None
            )
        elif existing.role < role:
            # given by hand now, so the access sync leaves it be
            _rows(ProjectMember).filter(pk=existing.pk).update(role=role, rbac_managed=False, rbac_original_role=None)


def _merge(model, field, parent, uid, new_id):
    rows = _rows(model)
    has_deleted_at = any(f.name == "deleted_at" for f in model._meta.concrete_fields)
    if has_deleted_at:
        rows.filter(**{field: uid}, deleted_at__isnull=False).delete()  # old, removed assignments: history only
    for item in rows.filter(**{field: uid}):
        parent_id = getattr(item, f"{parent}_id")
        theirs = rows.filter(**{parent: parent_id, field: new_id})
        live = theirs.filter(deleted_at__isnull=True) if has_deleted_at else theirs
        if live.exists():
            rows.filter(pk=item.pk).delete()  # already on it
        else:
            theirs.delete()  # a removed earlier assignment would clash
            rows.filter(pk=item.pk).update(**{field: new_id})


def delete_member(actor, workspace, target_id, transfer_to_id):
    """Deletes the person for good: shared work to `transfer_to_id`, their own records removed, then the account."""
    membership = check_can_act(actor, workspace, target_id)
    blocker = _delete_blockers(workspace, membership)
    if blocker:
        raise RemovalError(blocker)
    new_owner_membership = (
        WorkspaceMember.objects.filter(
            workspace=workspace,
            member_id=transfer_to_id,
            is_active=True,
            member__is_active=True,
            member__is_bot=False,
        )
        .exclude(member_id=target_id)
        .select_related("member")
        .first()
    )
    if new_owner_membership is None:
        raise RemovalError("Pick an active member to take over their work.")
    new_owner = new_owner_membership.member
    uid, new_id = membership.member_id, new_owner.id
    email = membership.member.email

    links = _person_links()
    unhandled = [
        f"{model.__name__}.{field.name}"
        for model, field in links
        if field.name not in AUDIT_FIELDS
        if (model.__name__, field.name) not in DELETE | TRANSFER | set(MERGE) | EMPTIED | PRECHECKED
        if field.remote_field.on_delete is not models.SET_NULL
    ]
    if unhandled:
        # a new kind of link to people: stop rather than let it be deleted unseen
        raise RemovalError(f"Can't delete safely yet: no rule for {', '.join(sorted(unhandled))}.")

    with transaction.atomic():
        User.objects.select_for_update().filter(pk=uid).first()
        _give_project_access(uid, new_owner, new_owner_membership.role)
        # their unfinished drafts are theirs alone
        _rows(DraftIssue).filter(created_by_id=uid).delete()
        for model, field in links:
            key = (model.__name__, field.name)
            if key in MERGE:
                _merge(model, field.name, MERGE[key], uid, new_id)
        for model, field in links:
            key = (model.__name__, field.name)
            if key in DELETE:
                _rows(model).filter(**{field.name: uid}).delete()
            elif key in TRANSFER or field.name in AUDIT_FIELDS:
                _rows(model).filter(**{field.name: uid}).update(**{field.name: new_id})
        Session.objects.filter(user_id=str(uid)).delete()
        WorkspaceMemberInvite.objects.filter(email__iexact=email).delete()
        # nothing left pointing at them but the links Django empties
        left = defaultdict(int)
        for model, field in links:
            if field.remote_field.on_delete is models.CASCADE:
                left[f"{model.__name__}.{field.name}"] += _rows(model).filter(**{field.name: uid}).count()
        still = {name: n for name, n in left.items() if n}
        if still:
            raise RemovalError(f"Stopped: records still point at them ({still}). Nothing was changed.")
        User.objects.filter(pk=uid).delete()
        schedule_project_access_sync(workspace.id)
    return {"member_id": str(uid), "transferred_to": str(new_id)}
