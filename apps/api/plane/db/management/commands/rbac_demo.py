# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from urllib.parse import urlparse

# Django imports
from django.conf import settings
from django.core.management import BaseCommand, CommandError
from django.db import transaction

# Module imports
from plane.db.models import (
    DEFAULT_STATES,
    Issue,
    IssueAssignee,
    Profile,
    Project,
    ProjectMember,
    ProjectTeam,
    ProjectUserProperty,
    Role,
    State,
    TeamMember,
    User,
    UserRole,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.workspace import Team
from plane.utils.rbac import sync_project_access

SLUG = "rbac-demo"
DOMAIN = "rbac-demo.local"
PASSWORD = "RbacDemo@2026"

# key -> (first name, last name, workspace role, RBAC role key)
PEOPLE = {
    "admin": ("Demo", "Admin", 20, None),
    "hr": ("Demo", "HR", 15, "hr"),
    "pm-a": ("Demo", "PM Team A", 15, "pm"),
    "pm-b": ("Demo", "PM Team B", 15, "pm"),
    "emp-a1": ("Demo", "Employee A1", 15, "employee"),
    "emp-a2": ("Demo", "Employee A2", 15, "employee"),
    "emp-b1": ("Demo", "Employee B1", 15, "employee"),
}
TEAMS = {"Team A": ("pm-a", ["emp-a1", "emp-a2"]), "Team B": ("pm-b", ["emp-b1"])}
# identifier -> (name, network, owning teams, members)
PROJECTS = {
    "ALPHA": ("Alpha", 2, ["Team A"], ["pm-a", "emp-a1", "emp-a2"]),
    "BETA": ("Beta", 2, ["Team B"], ["pm-b", "emp-b1", "emp-a1"]),
    "SHARED": ("Shared", 2, ["Team A", "Team B"], ["pm-a", "pm-b", "emp-a1", "emp-b1"]),
    "OPEN": ("Open", 2, [], []),
    "SECRET": ("Secret", 0, [], ["emp-b1"]),
}
# (project, title, assignee, creator)
WORK_ITEMS = [
    ("ALPHA", "Alpha: design review (A2)", "emp-a2", "pm-a"),
    ("ALPHA", "Alpha: unassigned idea from A1", None, "emp-a1"),
    ("BETA", "Beta: API work (B1)", "emp-b1", "pm-b"),
    ("BETA", "Beta: help from A1 (Team A's member)", "emp-a1", "pm-b"),
    ("SHARED", "Shared: A1's task", "emp-a1", "pm-a"),
    ("SHARED", "Shared: B1's task", "emp-b1", "pm-b"),
    ("SHARED", "Shared: nobody's yet", None, "pm-a"),
    ("OPEN", "Open: HR policy update (HR)", "hr", "admin"),
    ("SECRET", "Secret: B1's private task", "emp-b1", "admin"),
]


def email(key):
    return f"demo-{key}@{DOMAIN}"


class Command(BaseCommand):
    help = (
        f"Local testing of role-based access: creates the '{SLUG}' workspace with an admin, HR, two PMs and three "
        f"employees (password {PASSWORD}), teams, projects and work items, with role-based access on. "
        "--remove deletes it all again."
    )

    def add_arguments(self, parser):
        parser.add_argument("--remove", action="store_true", help="delete the demo workspace and its accounts")
        parser.add_argument("--force", action="store_true", help="create it even though the app isn't on localhost")

    def handle(self, *args, **options):
        if options["remove"]:
            Workspace.all_objects.filter(slug=SLUG).delete()
            User.objects.filter(email__endswith=f"@{DOMAIN}").delete()
            self.stdout.write(self.style.SUCCESS(f"Removed the {SLUG} workspace and its demo accounts"))
            return
        # accounts with a published password: never on a server people can reach
        host = urlparse(settings.APP_BASE_URL or settings.WEB_URL or "").hostname
        if host not in ("localhost", "127.0.0.1") and not options["force"]:
            raise CommandError(
                f"The app runs at {host or 'an unknown address'}, not localhost: the demo is for local testing"
            )
        if Workspace.all_objects.filter(slug=SLUG).exists():
            self.stdout.write(self.style.WARNING(f"The {SLUG} workspace already exists; --remove it first"))
            return

        with transaction.atomic():
            users = {}
            for key, (first, last, _, _) in PEOPLE.items():
                user = User.objects.filter(email=email(key)).first() or User(email=email(key))
                user.username = f"demo_{key.replace('-', '_')}"
                user.display_name = f"demo-{key}"
                user.first_name, user.last_name = first, last
                user.is_active = user.is_email_verified = True
                user.is_password_autoset = False
                user.set_password(PASSWORD)
                user.save()
                users[key] = user

            workspace = Workspace.objects.create(name="RBAC Demo", slug=SLUG, owner=users["admin"])
            roles = {role.key: role for role in Role.objects.filter(workspace=workspace, is_system=True)}
            for key, (_, _, workspace_role, role_key) in PEOPLE.items():
                WorkspaceMember.objects.create(workspace=workspace, member=users[key], role=workspace_role)
                if role_key:
                    UserRole.objects.create(workspace=workspace, member=users[key], role=roles[role_key])
                profile, _ = Profile.objects.get_or_create(user=users[key])
                profile.is_onboarded = profile.is_tour_completed = True
                profile.onboarding_step = {step: True for step in profile.onboarding_step}
                profile.last_workspace_id = workspace.id
                profile.save()

            teams = {}
            for name, (lead, members) in TEAMS.items():
                teams[name] = Team.objects.create(workspace=workspace, name=name)
                TeamMember.objects.create(workspace=workspace, team=teams[name], member=users[lead], is_lead=True)
                for key in members:
                    TeamMember.objects.create(workspace=workspace, team=teams[name], member=users[key])

            projects = {}
            for identifier, (name, network, team_names, members) in PROJECTS.items():
                project = Project.objects.create(
                    workspace=workspace, name=name, identifier=identifier, network=network, project_lead=users["admin"]
                )
                State.objects.bulk_create(
                    [
                        State(
                            name=state["name"],
                            color=state["color"],
                            project=project,
                            sequence=state["sequence"],
                            workspace=workspace,
                            group=state["group"],
                            default=state.get("default", False),
                        )
                        for state in DEFAULT_STATES
                    ]
                )
                for key, role in [("admin", 20), *((member, 15) for member in members)]:
                    ProjectMember.objects.create(workspace=workspace, project=project, member=users[key], role=role)
                    ProjectUserProperty.objects.get_or_create(workspace=workspace, project=project, user=users[key])
                for team_name in team_names:
                    ProjectTeam.objects.create(workspace=workspace, project=project, team=teams[team_name])
                projects[identifier] = project

            for identifier, title, assignee, creator in WORK_ITEMS:
                issue = Issue.objects.create(workspace=workspace, project=projects[identifier], name=title)
                # BaseModel.save takes the creator from the request; a command has none
                Issue.all_objects.filter(pk=issue.pk).update(created_by=users[creator])
                if assignee:
                    IssueAssignee.objects.create(
                        workspace=workspace, project=projects[identifier], issue=issue, assignee=users[assignee]
                    )

            workspace.is_rbac_enabled = True
            workspace.save(update_fields=["is_rbac_enabled"])
            changed = sync_project_access(workspace.id)

        self.stdout.write(self.style.SUCCESS(f"Created the {SLUG} workspace ({changed} memberships from roles)"))
        self.stdout.write(f"Sign in at /{SLUG}/ with password {PASSWORD} as:")
        for key, (_, last, _, _) in PEOPLE.items():
            self.stdout.write(f"  {email(key):<36}{last}")
