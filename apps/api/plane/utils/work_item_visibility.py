# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Private work items: a work item is only visible to the people it belongs to.

  * Assigned work items: only their assignee(s). Admins and the creator don't see them either.
  * Unassigned work items: their creator, project admins and workspace admins.
  * Work items assigned to a group (plane.db.models.member_group): as unassigned, plus everyone in the group.

Enforced in two places, like ticket isolation (plane.utils.ticket_isolation):
  * the Issue managers (`objects`, `issue_objects`) filter every work item query made while a request is served,
    so lists, boards, search, cycles, modules, views and counts only contain visible work items;
  * WorkItemVisibilityMixin answers 404 for any URL that points at a hidden work item or at one of its
    comments / attachments (comments, links, activity, worklogs, ... are separate tables).

Outside a request (background tasks, management commands) nothing is filtered, except where a task works on
someone's behalf and says so with `as_viewer(user, workspace_id)` (exports). Helpdesk tickets have their own
rules and are not affected.

Role-based access (plane.utils.rbac): in a workspace with RBAC on, the person's roles, teams and shares decide
instead of the rule above, for that workspace's work items:
  * what they see: `AccessProfile.work_item_q("view")`, through the same managers and the same 404s;
  * what they may change: views that set `rbac_work_item_actions` (HTTP method -> view/create/edit/delete) are
    checked before they run; the work items in the URL and in the body (`issue_ids`, `sub_issue_ids`, `updates`)
    must all be within the person's scope for that action, and creating needs the project to be within it.
    Views that set `rbac_project_actions` (viewset action or HTTP method -> create/edit/delete) are checked against
    the person's project scope the same way.
"""

# Python imports
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

# Django imports
from django.db.models import Exists, OuterRef, Q

# Third party imports
from celery.signals import task_postrun, task_prerun
from rest_framework.exceptions import NotFound, PermissionDenied

# Module imports
from plane.utils.ticket_isolation import _uuid_values

ROLE_ADMIN = 20

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


@dataclass
class Viewer:
    """Whose view of work items is being served, and in which workspace with role-based access (if it's on)."""

    user: object
    workspace_id: object = None
    # plane.utils.rbac.AccessProfile when the workspace has RBAC on
    profile: object = None


# The viewer being served; None means "don't filter"
_viewer = ContextVar("work_item_viewer", default=None)


def make_viewer(user, workspace_id=None, request=None):
    """A Viewer for `user`; with the RBAC profile when `workspace_id` has role-based access on."""
    from plane.utils.rbac import AccessProfile, access_for, is_rbac_enabled

    if workspace_id is None or not is_rbac_enabled(workspace_id):
        return Viewer(user=user, workspace_id=workspace_id)
    profile = access_for(request, workspace_id) if request is not None else AccessProfile.load(user, workspace_id)
    return Viewer(user=user, workspace_id=workspace_id, profile=profile)


def visible_to(user):
    """Q for the work items `user` may see."""
    from plane.db.models import IssueAssignee, ProjectMember, WorkspaceMember
    from plane.db.models.member_group import groups_of

    assignees = IssueAssignee.all_objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
    admin_projects = ProjectMember.objects.filter(member_id=user.id, role=ROLE_ADMIN, is_active=True).values(
        "project_id"
    )
    admin_workspaces = WorkspaceMember.objects.filter(member_id=user.id, role=ROLE_ADMIN, is_active=True).values(
        "workspace_id"
    )
    return (
        Q(Exists(assignees.filter(assignee_id=user.id)))
        | (
            ~Q(Exists(assignees))
            & (Q(created_by_id=user.id) | Q(project_id__in=admin_projects) | Q(workspace_id__in=admin_workspaces))
        )
        | Q(assignee_group_id__in=groups_of([user.id]))
    )


def viewer_q(viewer):
    """Q for the work items `viewer` may see: role-based in their RBAC workspace, the private rule elsewhere."""
    if viewer.profile is None:
        return visible_to(viewer.user)
    in_workspace = Q(workspace_id=viewer.workspace_id)
    return (in_workspace & viewer.profile.work_item_q("view")) | (~in_workspace & visible_to(viewer.user))


def filter_visible(queryset):
    """Used by the Issue managers: narrows `queryset` to the current viewer's work items, if there is one."""
    viewer = _viewer.get()
    if viewer is None:
        return queryset
    return queryset.filter(viewer_q(viewer))


@contextmanager
def all_work_items():
    """Temporarily see every work item, for the server's own bookkeeping inside a request."""
    token = _viewer.set(None)
    try:
        yield
    finally:
        _viewer.reset(token)


@contextmanager
def as_viewer(user, workspace_id=None):
    """See work items as `user` does (in `workspace_id`), for background work done on their behalf (exports)."""
    token = _viewer.set(make_viewer(user, workspace_id))
    try:
        yield
    finally:
        _viewer.reset(token)


def who_can_see(issue, user_ids):
    """The ids among `user_ids` who may see `issue` (the rules above, role-based where it's on), e.g. so nobody is
    notified about a work item they can't open."""
    from plane.db.models import Issue, User

    visible = set()
    for user in User.objects.filter(pk__in=set(user_ids)):
        viewer = make_viewer(user, issue.workspace_id)
        if Issue.all_objects.filter(pk=issue.pk).filter(viewer_q(viewer)).exists():
            visible.add(user.id)
    return visible


def references_hidden_work_item(kwargs, viewer):
    """True when a URL points at a work item `viewer` can't see, or at a comment / attachment of one."""
    from plane.db.models import FileAsset, Issue, IssueComment

    values = _uuid_values(kwargs)
    if not values:
        return False
    issue_ids = set(Issue.all_objects.filter(id__in=values).values_list("id", flat=True))
    issue_ids |= set(
        IssueComment.all_objects.filter(id__in=values, issue_id__isnull=False).values_list("issue_id", flat=True)
    )
    issue_ids |= set(
        FileAsset.all_objects.filter(id__in=values, issue_id__isnull=False).values_list("issue_id", flat=True)
    )
    if not issue_ids:
        return False
    return (
        Issue.all_objects.filter(id__in=issue_ids, project__is_ticket_project=False).exclude(viewer_q(viewer)).exists()
    )


def _as_uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _body_work_item_ids(data):
    """Work items a request body points at: bulk ids, sub-issue ids, date updates."""
    if not isinstance(data, dict):
        return []
    ids = []
    for key in ("issue_ids", "sub_issue_ids"):
        value = data.get(key)
        if isinstance(value, list):
            ids += value
    updates = data.get("updates")
    if isinstance(updates, list):
        ids += [update.get("id") for update in updates if isinstance(update, dict)]
    return ids


def check_work_item_access(view, request, kwargs, profile):
    """Role-based check of a write on work items (see module docstring). Raises PermissionDenied."""
    from plane.db.models import Issue

    action = view.rbac_work_item_action(request, kwargs)
    if not action:
        return
    if action == "create":
        project_id = _as_uuid(view.rbac_create_project_id(request, kwargs))
        if project_id is None or not profile.can_create_work_item(project_id):
            raise PermissionDenied("Your role doesn't allow creating work items in this project.")
        return
    # the work item in the URL: `issue_id` on a work item's links, attachments, ... (their `pk` is theirs), else `pk`
    url_id = kwargs.get("issue_id", kwargs.get("pk"))
    raw_ids = ([url_id] if url_id else []) + _body_work_item_ids(request.data)
    ids = {_as_uuid(value) for value in raw_ids} - {None}
    if not profile.can("work_items", action) or (
        ids
        and Issue.all_objects.filter(pk__in=ids, workspace_id=profile.workspace_id)
        .filter(profile.work_item_q(action))
        .count()
        < len(ids)
    ):
        raise PermissionDenied(f"Your role doesn't allow you to {action} this work item.")


def check_project_access(view, request, kwargs, profile):
    """Role-based check of a change to a project (views that set `rbac_project_actions`). Raises PermissionDenied."""
    action = view.rbac_project_action(request, kwargs)
    if not action:
        return
    if action == "create":
        if not profile.can("projects", "create"):
            raise PermissionDenied("Your role doesn't allow creating projects.")
        return
    project_id = _as_uuid(kwargs.get("project_id") or kwargs.get("pk"))
    if project_id is None or not profile.can_on_project_id(action, project_id):
        raise PermissionDenied(f"Your role doesn't allow you to {action} this project.")


def check_module_access(view, request, kwargs, profile):
    """Role-based check of a module that lives in projects (views that set `rbac_project_module`), reads included."""
    workspace_module = getattr(view, "rbac_workspace_module", None)
    if workspace_module and not profile.can(workspace_module, "view"):
        raise PermissionDenied(f"Your role doesn't include {workspace_module.replace('_', ' ')}.")
    module = getattr(view, "rbac_project_module", None)
    project_id = _as_uuid(kwargs.get("project_id"))
    if not module or project_id is None:
        return
    action = view.rbac_module_actions.get(request.method)
    if action and not profile.can_in_project(module, action, project_id):
        raise PermissionDenied(f"Your role doesn't allow you to {action} {module.replace('_', ' ')} in this project.")


class WorkItemVisibilityMixin:
    """Serves each request with the signed-in user's view of work items (see module docstring)."""

    _visibility_token = None
    # Views that change work items: HTTP method -> the role action it needs (view / create / edit / delete)
    rbac_work_item_actions = {}

    def rbac_work_item_action(self, request, kwargs):
        """The role action this request needs on work items; None = not checked here."""
        return self.rbac_work_item_actions.get(request.method)

    # Views that change projects: viewset action or HTTP method -> the role action it needs (create / edit / delete)
    rbac_project_actions = {}

    # Views of a whole-workspace module (e.g. "analytics"): the role needs "view" on it
    rbac_workspace_module = None
    # Views of a module that lives in projects (e.g. "milestones"): HTTP method -> the role action it needs
    rbac_project_module = None
    rbac_module_actions = {"GET": "view", "POST": "create", "PUT": "edit", "PATCH": "edit", "DELETE": "delete"}

    def rbac_project_action(self, request, kwargs):
        """The role action this request needs on a project; None = not checked here."""
        actions = self.rbac_project_actions
        return actions.get(getattr(self, "action", None)) or actions.get(request.method)

    def rbac_create_project_id(self, request, kwargs):
        """The project a "create" lands in: the URL's, else the body's."""
        data = request.data if isinstance(request.data, dict) else {}
        return kwargs.get("project_id") or data.get("project_id")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        user = request.user
        if not user or not user.is_authenticated or getattr(user, "is_bot", False):
            return
        viewer = make_viewer(user, self._rbac_workspace_id(kwargs), request)
        self._visibility_token = _viewer.set(viewer)
        if references_hidden_work_item(kwargs, viewer):
            raise NotFound()
        if viewer.profile is not None:
            check_module_access(self, request, kwargs, viewer.profile)
        if viewer.profile is not None and request.method not in SAFE_METHODS:
            check_work_item_access(self, request, kwargs, viewer.profile)
            check_project_access(self, request, kwargs, viewer.profile)

    @staticmethod
    def _rbac_workspace_id(kwargs):
        from plane.db.models import Workspace

        slug = kwargs.get("slug")
        if not slug:
            return None
        return Workspace.objects.filter(slug=slug).values_list("id", flat=True).first()

    def finalize_response(self, request, response, *args, **kwargs):
        if self._visibility_token is not None:
            _viewer.reset(self._visibility_token)
            self._visibility_token = None
        return super().finalize_response(request, response, *args, **kwargs)


# Background tasks see everything, also when they run inside a request (eager mode in tests)
_task_tokens = {}


@task_prerun.connect
def _see_all_in_tasks(task_id=None, **_):
    _task_tokens[task_id] = _viewer.set(None)


@task_postrun.connect
def _restore_after_task(task_id=None, **_):
    token = _task_tokens.pop(task_id, None)
    if token is not None:
        _viewer.reset(token)
