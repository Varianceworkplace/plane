# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import hashlib
from collections import defaultdict

# Django imports
from django.db.models import Count, Max
from django.utils.http import parse_etags, quote_etag

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import ProjectMember, State
from plane.app.permissions import WorkspaceEntityPermission

# StateSerializer's fields, in its order ("order" is worked out below)
STATE_FIELDS = ("id", "project_id", "workspace_id", "name", "color", "group", "default", "description", "sequence")


class WorkspaceStatesEndpoint(BaseAPIView):
    """Every state of the projects the person belongs to: the app loads them once per page load, for state names and
    colours across projects.

    With ~1,300 projects that is ~7,800 states (2 MB), so they are built from plain rows rather than model objects and
    a serializer, and the response carries an ETag: when nothing that decides it has changed since the browser's
    copy, the answer is a 304 with no body, worked out from two small counts instead of the whole list."""

    permission_classes = [WorkspaceEntityPermission]
    use_read_replica = True

    def get(self, request, slug):
        states = State.objects.filter(
            workspace__slug=slug,
            project__project_projectmember__member=request.user,
            project__project_projectmember__is_active=True,
            # a membership removed and later re-added leaves a deleted row behind: don't list the states twice
            project__project_projectmember__deleted_at__isnull=True,
            project__archived_at__isnull=True,
            is_triage=False,
        )

        etag = quote_etag(self.fingerprint(request, slug, states))
        sent = request.headers.get("If-None-Match")
        # the gzip middleware sends the tag as weak (W/"…"); either form is the same version
        if sent and etag in {tag.removeprefix("W/") for tag in parse_etags(sent)}:
            return self.cacheable(Response(status=status.HTTP_304_NOT_MODIFIED), etag)

        rows = list(states.order_by("sequence", "created_at").values(*STATE_FIELDS))
        # "order" (how full a state's icon is drawn) is its place among its project's states of the same group, as
        # the project's own state list works it out (it replaces these once a project is opened)
        grouped_states = defaultdict(list)
        for state in rows:
            grouped_states[(state["project_id"], state["group"])].append(state)
        for group_states in grouped_states.values():
            count = len(group_states)
            for index, state in enumerate(group_states, start=1):
                state["order"] = index / count

        return self.cacheable(Response(rows, status=status.HTTP_200_OK), etag)

    @staticmethod
    def fingerprint(request, slug, states):
        """Changes whenever the list would: a state added, changed or removed (count, latest change), or a project
        joined, left, archived or restored (the person's memberships and the states they reach)."""
        listed = states.aggregate(count=Count("id"), changed=Max("updated_at"))
        memberships = ProjectMember.objects.filter(workspace__slug=slug, member=request.user).aggregate(
            count=Count("id"), changed=Max("updated_at")
        )
        parts = (
            "states-v1",
            request.user.id,
            slug,
            listed["count"],
            listed["changed"],
            memberships["count"],
            memberships["changed"],
        )
        return hashlib.sha256(":".join(str(part) for part in parts).encode()).hexdigest()[:32]

    @staticmethod
    def cacheable(response, etag):
        # the browser keeps its copy but asks every time (no-cache), sending the tag back; private: per person
        response["ETag"] = etag
        response["Cache-Control"] = "private, no-cache"
        return response
