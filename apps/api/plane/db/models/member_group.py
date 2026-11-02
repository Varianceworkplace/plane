# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Groups (Workspace settings › Groups): named sets of workspace members, such as "PHP Group", that a project task can
be assigned to instead of one person (`Issue.assignee_group`; a task has a person or a group, never both).

  * Everyone in the group sees the group's tasks, also in projects they aren't a member of: while role-based access
    is on, the membership sync (plane.utils.rbac.desired_project_roles) adds them to those projects.
  * Seeing is all a group gives. Editing a group task follows the roles as for any task nobody is assigned to (its
    creator, the project's PMs, HR, admins).
  * Not the same as Teams (Access control › Teams): a team is a PM and their people; a group is only who a task goes to.
"""

# Django imports
from django.conf import settings
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver

# Module imports
from .base import BaseModel


class MemberGroup(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="member_groups")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")

    class Meta:
        verbose_name = "Member Group"
        verbose_name_plural = "Member Groups"
        db_table = "member_groups"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"],
                condition=models.Q(deleted_at__isnull=True),
                name="member_group_unique_name_per_workspace_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.workspace_id} {self.name}"


class MemberGroupMember(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="member_group_members")
    group = models.ForeignKey(MemberGroup, on_delete=models.CASCADE, related_name="group_members")
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="member_group_memberships"
    )

    class Meta:
        verbose_name = "Member Group Member"
        verbose_name_plural = "Member Group Members"
        db_table = "member_group_members"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["group", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="member_group_member_unique_when_deleted_at_null",
            )
        ]

    def __str__(self):
        return f"{self.group_id} {self.member_id}"


def groups_of(user_ids):
    """Subquery: the live groups these people are in."""
    return MemberGroupMember.objects.filter(member_id__in=user_ids, group__deleted_at__isnull=True).values("group_id")


@receiver(post_save, sender="db.Issue")
def group_assignment_changed(sender, instance, created, **kwargs):
    # the group's members get (or lose) access to the task's project
    if instance.assignee_group_id if created else instance.has_changed("assignee_group_id"):
        from .rbac import schedule_project_access_sync

        schedule_project_access_sync(instance.workspace_id)
