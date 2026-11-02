# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.core.management import BaseCommand, CommandError

# Module imports
from plane.db.models import User, Workspace
from plane.utils.rbac import sync_project_access
from plane.utils.rbac_rollout import rollout_preview


class Command(BaseCommand):
    help = (
        "Role-based access rollout for one workspace: show what turning it on changes (default), "
        "or switch it --on / --off and update project memberships right away"
    )

    def add_arguments(self, parser):
        parser.add_argument("slug", type=str, help="workspace slug")
        switch = parser.add_mutually_exclusive_group()
        switch.add_argument("--on", action="store_true", help="turn role-based access on")
        switch.add_argument("--off", action="store_true", help="turn role-based access off and undo its memberships")

    def handle(self, *args, **options):
        workspace = Workspace.objects.filter(slug=options["slug"]).first()
        if not workspace:
            raise CommandError(f"Error: no workspace with slug {options['slug']}")

        if options["on"] or options["off"]:
            workspace.is_rbac_enabled = bool(options["on"])
            workspace.save(update_fields=["is_rbac_enabled"])
            changed = sync_project_access(workspace.id)
            state = "on" if workspace.is_rbac_enabled else "off"
            self.stdout.write(
                self.style.SUCCESS(f"Role-based access is {state}; {changed} project memberships updated")
            )
            return

        preview = rollout_preview(workspace)
        names = {
            str(user.id): user.display_name or user.email
            for user in User.objects.filter(pk__in=[p["member_id"] for p in preview["people"]])
        }
        state = "on" if preview["is_rbac_enabled"] else "off"
        self.stdout.write(f"Role-based access is {state} in {workspace.slug}\n")
        self.stdout.write(
            f"{'Person':<28}{'Roles':<28}{'Work items now -> on':<22}{'Projects see/change':<21}Added/raised"
        )
        for person in preview["people"]:
            roles = "Workspace admin" if person["is_workspace_admin"] else ", ".join(person["roles"]) or "(no role)"
            items = f"{person['work_items']['now']} -> {person['work_items']['after']}"
            projects = f"{person['projects']['view']} / {person['projects']['edit']}"
            memberships = f"{person['memberships']['added']} / {person['memberships']['raised']}"
            self.stdout.write(
                f"{names[person['member_id']][:27]:<28}{roles[:27]:<28}{items:<22}{projects:<21}{memberships}"
            )

        warnings = preview["warnings"]
        notes = [
            ("No role yet (no projects until one is given)", [names[i] for i in warnings["without_role"]]),
            ("Teams without a lead", warnings["teams_without_lead"]),
            ("Projects no team owns (only HR and admins can change them)", warnings["projects_without_team"]),
            ("Will see fewer work items", [names[i] for i in warnings["seeing_fewer_work_items"]]),
        ]
        for title, items in notes:
            if items:
                self.stdout.write(self.style.WARNING(f"\n{title}: {', '.join(items)}"))
