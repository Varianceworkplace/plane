# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Projects › Project Tasks: the search box (plane.utils.work_item_search, the workspace work item list).

* words find the tasks whose name or status contains them, in any case ("Comp" finds the Completed ones), and so does
  every other field: description, priority, dates as shown, people, labels, modules, milestone, Project Task fields;
* a task number finds that task: "ACMEWEB-2" (any case), or the bare number "2" in every project;
* the count follows the search, and search never shows a task the person may not see.
"""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from datetime import date

from plane.db.models import (
    Issue,
    IssueLabel,
    IssueTaskDetail,
    Label,
    Milestone,
    MilestoneWorkItem,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)


def _user(workspace, first_name, role=15):
    uid = uuid4().hex[:8]
    user = User.objects.create(
        email=f"{first_name.lower()}-{uid}@plane.so",
        username=f"{first_name.lower()}_{uid}",
        first_name=first_name,
        display_name=first_name.lower(),
    )
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _project(workspace, owner, name, identifier, members):
    project = Project.objects.create(name=name, identifier=identifier, workspace=workspace, created_by=owner)
    State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    State.objects.create(name="Completed", project=project, workspace=workspace, group="completed")
    for member in members:
        ProjectMember.objects.create(project=project, member=member, role=15, is_active=True)
    return project


@pytest.fixture
def setup(db, workspace, create_user):
    hiral, vijay = _user(workspace, "Hiral"), _user(workspace, "Vijay")
    acme = _project(workspace, create_user, "Acme Retail", "ACMEWEB", [create_user, hiral, vijay])
    blue = _project(workspace, create_user, "Bluewave", "BLUEAPP", [create_user, hiral, vijay])
    clients = {"hiral": _client(hiral), "vijay": _client(vijay)}

    def create(project, name, assignee=None):
        payload = {"name": name, "assignee_ids": [str(assignee.id)] if assignee else []}
        response = clients["hiral"].post(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/", payload, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED, response.content
        return Issue.objects.get(pk=response.json()["id"])

    tasks = {
        "filters": create(acme, "Product listing page – filters and sorting", hiral),
        "checkout": create(acme, "Fix checkout validation", hiral),
        "login": create(blue, "Login screen", hiral),
        "private": create(blue, "Payroll export for Vijay", vijay),  # Vijay's own: Hiral may not see it
    }
    Issue.objects.filter(pk=tasks["login"].pk).update(state=State.objects.get(project=blue, name="Completed"))
    return {"workspace": workspace, "clients": clients, "tasks": tasks}


def _search(setup, who, term):
    response = setup["clients"][who].get(
        f"/api/workspaces/{setup['workspace'].slug}/issues/", {"search": term, "per_page": 50, "cursor": "50:0:0"}
    )
    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()
    rows = body["results"]
    if isinstance(rows, dict):  # grouped results
        rows = [issue for group in rows.values() for issue in group.get("results", [])]
    return {issue["name"] for issue in rows}, body.get("total_count")


@pytest.mark.contract
def test_words_find_names_in_any_case(setup):
    names, count = _search(setup, "hiral", "CHECKOUT")
    assert names == {"Fix checkout validation"} and count == 1
    assert _search(setup, "hiral", "filters and")[0] == {"Product listing page – filters and sorting"}


@pytest.mark.contract
def test_a_task_number_finds_that_task(setup):
    checkout = setup["tasks"]["checkout"]
    assert _search(setup, "hiral", f"acmeweb-{checkout.sequence_id}")[0] == {"Fix checkout validation"}


@pytest.mark.contract
def test_a_bare_number_finds_it_in_every_project(setup):
    # both projects' first task is number 1
    assert _search(setup, "hiral", "1")[0] == {"Product listing page – filters and sorting", "Login screen"}


@pytest.mark.contract
def test_no_match_and_no_search(setup):
    assert _search(setup, "hiral", "nothing like this") == (set(), 0)
    names, count = _search(setup, "hiral", "   ")
    assert names == {"Product listing page – filters and sorting", "Fix checkout validation", "Login screen"}
    assert count == 3


@pytest.mark.contract
def test_search_never_shows_a_task_the_person_may_not_see(setup):
    private = setup["tasks"]["private"]
    assert _search(setup, "hiral", "Payroll")[0] == set()
    assert _search(setup, "hiral", f"BLUEAPP-{private.sequence_id}")[0] == set()
    assert _search(setup, "vijay", "Payroll")[0] == {"Payroll export for Vijay"}


def _project_search(setup, who, project, term, detail=False):
    """A project's own task list (projects › <project> › Project tasks); `detail` = the list the table layout uses."""
    path = "issues-detail" if detail else "issues"
    params = {"search": term, "per_page": 50, "cursor": "50:0:0"}
    if detail:
        params["expand"] = "issue_relation,issue_related"
    response = setup["clients"][who].get(
        f"/api/workspaces/{setup['workspace'].slug}/projects/{project.id}/{path}/", params
    )
    assert response.status_code == status.HTTP_200_OK, response.content
    body = response.json()
    rows = body["results"]
    if isinstance(rows, dict):  # grouped results
        rows = [issue for group in rows.values() for issue in group.get("results", [])]
    return {issue["name"] for issue in rows}, body.get("total_count")


@pytest.mark.contract
@pytest.mark.parametrize("detail", [False, True])
def test_a_projects_own_list_searches_too(setup, detail):
    acme = setup["tasks"]["checkout"].project
    names, count = _project_search(setup, "hiral", acme, "Checkout", detail)
    assert names == {"Fix checkout validation"} and count == 1
    filters = setup["tasks"]["filters"]
    assert _project_search(setup, "hiral", acme, f"ACMEWEB-{filters.sequence_id}", detail)[0] == {
        "Product listing page – filters and sorting"
    }
    # the bare number stays within the project
    assert _project_search(setup, "hiral", acme, "1", detail)[0] == {"Product listing page – filters and sorting"}
    names, count = _project_search(setup, "hiral", acme, "", detail)
    assert count == 2


@pytest.mark.contract
@pytest.mark.parametrize("detail", [False, True])
def test_a_projects_own_list_hides_what_the_person_may_not_see(setup, detail):
    blue = setup["tasks"]["private"].project
    assert _project_search(setup, "hiral", blue, "Payroll", detail)[0] == set()
    assert _project_search(setup, "vijay", blue, "Payroll", detail)[0] == {"Payroll export for Vijay"}


@pytest.mark.contract
def test_a_status_finds_the_tasks_in_it(setup):
    # "Comp" / "completed" (any case) find the Completed task; no task name contains it
    assert _search(setup, "hiral", "Comp")[0] == {"Login screen"}
    assert _search(setup, "hiral", "COMPLETED")[0] == {"Login screen"}
    blue = setup["tasks"]["login"].project
    assert _project_search(setup, "hiral", blue, "completed")[0] == {"Login screen"}
    # a status still never shows someone else's private task
    completed = State.objects.get(project=blue, name="Completed")
    Issue.objects.filter(pk=setup["tasks"]["private"].pk).update(state=completed)
    assert _search(setup, "hiral", "completed")[0] == {"Login screen"}


@pytest.mark.contract
def test_every_field_of_a_task_is_searched(setup):
    task = setup["tasks"]["checkout"]
    project, workspace = task.project, task.workspace
    hiral = User.objects.get(first_name="Hiral")
    Issue.objects.filter(pk=task.pk).update(
        priority="urgent",
        description_stripped="Card payments fail at the last step",
        start_date=date(2026, 5, 18),
        target_date=date(2026, 6, 2),
    )
    label = Label.objects.create(name="Payments gateway", project=project, workspace=workspace)
    IssueLabel.objects.create(issue=task, label=label, project=project, workspace=workspace)
    module = Module.objects.create(name="Storefront sprint", project=project, workspace=workspace)
    ModuleIssue.objects.create(issue=task, module=module, project=project, workspace=workspace)
    milestone = Milestone.objects.create(title="UAT sign-off", project=project, workspace=workspace, assigned_to=hiral)
    MilestoneWorkItem.objects.create(issue=task, milestone=milestone, project=project, workspace=workspace)
    IssueTaskDetail.objects.update_or_create(
        issue=task,
        defaults={
            "project": project,
            "workspace": workspace,
            "technology": "Laravel",
            "git_url": "https://git.acme/pay",
        },
    )
    checkout = {"Fix checkout validation"}
    for term in (
        "card payments",  # description
        "URGENT",  # priority
        "May 18, 2026",  # start date as the app shows it
        "jun 02",  # due date
        "2026-06-02",  # due date as a date
        "gateway",  # label
        "storefront sprint",  # module
        "uat sign",  # milestone
        "laravel",  # Project Task field
        "git.acme",  # a link
    ):
        assert _search(setup, "hiral", term)[0] == checkout, term
        assert _project_search(setup, "hiral", project, term)[0] == checkout, term
    # people: the assignee's name (every task here is Hiral's) and who created it
    assert "Fix checkout validation" in _search(setup, "hiral", "hiral")[0]
    # a field of a task the person may not see doesn't reveal it
    assert _search(setup, "hiral", "vijay")[0] == set()


# ---------------------------------------------------------------- the date filter


def _dated(setup, who, project=None, detail=False, **params):
    """The names a list shows with these query params: Project Tasks, or a project's own list (`detail` = table)."""
    slug = setup["workspace"].slug
    if project is None:
        url = f"/api/workspaces/{slug}/issues/"
    else:
        url = f"/api/workspaces/{slug}/projects/{project.id}/{'issues-detail' if detail else 'issues'}/"
        if detail:
            params["expand"] = "issue_relation,issue_related"
    response = setup["clients"][who].get(url, {"per_page": 50, "cursor": "50:0:0", **params})
    assert response.status_code == status.HTTP_200_OK, response.content
    rows = response.json()["results"]
    if isinstance(rows, dict):
        rows = [issue for group in rows.values() for issue in group.get("results", [])]
    return {issue["name"] for issue in rows}


@pytest.fixture
def dated(setup):
    tasks = setup["tasks"]
    for key, start, due in (
        ("filters", date(2026, 5, 18), date(2026, 5, 25)),
        ("checkout", date(2026, 6, 1), date(2026, 6, 10)),
        ("login", None, date(2026, 5, 20)),
        ("private", date(2026, 5, 19), date(2026, 5, 19)),
    ):
        Issue.objects.filter(pk=tasks[key].pk).update(start_date=start, target_date=due)
    return setup


FILTERS, CHECKOUT, LOGIN = "Product listing page – filters and sorting", "Fix checkout validation", "Login screen"


@pytest.mark.contract
def test_a_start_date_range(dated):
    picked = {"date_field": "start_date", "date_from": "2026-05-01", "date_to": "2026-05-31"}
    assert _dated(dated, "hiral", **picked) == {FILTERS}


@pytest.mark.contract
def test_one_due_day_and_open_ranges(dated):
    assert _dated(dated, "hiral", date_field="due_date", date_from="2026-06-10", date_to="2026-06-10") == {CHECKOUT}
    assert _dated(dated, "hiral", date_field="due_date", date_from="2026-05-21") == {FILTERS, CHECKOUT}
    assert _dated(dated, "hiral", date_field="due_date", date_to="2026-05-20") == {LOGIN}


@pytest.mark.contract
def test_a_reversed_range_is_turned_round(dated):
    assert _dated(dated, "hiral", date_field="due_date", date_from="2026-05-31", date_to="2026-05-01") == {
        FILTERS,
        LOGIN,
    }


@pytest.mark.contract
def test_an_unknown_field_or_day_leaves_the_list_as_it_is(dated):
    everything = {FILTERS, CHECKOUT, LOGIN}
    assert _dated(dated, "hiral", date_field="birthday", date_from="2026-05-01") == everything
    assert _dated(dated, "hiral", date_field="due_date", date_from="31/05/2026") == everything
    assert _dated(dated, "hiral", date_field="due_date") == everything


@pytest.mark.contract
def test_created_and_changed_count_by_the_persons_own_day(dated):
    hiral = User.objects.get(first_name="Hiral")
    hiral.user_timezone = "Asia/Kolkata"
    hiral.save(update_fields=["user_timezone"])
    dated["clients"]["hiral"].force_authenticate(user=hiral)  # requests read the person as saved now
    # created just after midnight in India, which is still the day before in UTC
    Issue.objects.filter(pk=dated["tasks"]["login"].pk).update(created_at="2026-05-04T19:00:00+00:00")
    assert _dated(dated, "hiral", date_field="created_on", date_from="2026-05-05", date_to="2026-05-05") == {LOGIN}
    assert _dated(dated, "hiral", date_field="created_on", date_from="2026-05-04", date_to="2026-05-04") == set()


@pytest.mark.contract
def test_with_the_search_box_too(dated):
    picked = {"date_field": "due_date", "date_from": "2026-05-01", "date_to": "2026-06-30"}
    assert _dated(dated, "hiral", search="checkout", **picked) == {CHECKOUT}


@pytest.mark.contract
@pytest.mark.parametrize("detail", [False, True])
def test_a_projects_own_list_filters_by_date_too(dated, detail):
    acme = dated["tasks"]["filters"].project
    picked = {"date_field": "start_date", "date_from": "2026-05-01", "date_to": "2026-05-31"}
    assert _dated(dated, "hiral", project=acme, detail=detail, **picked) == {FILTERS}


@pytest.mark.contract
def test_a_date_never_shows_a_task_the_person_may_not_see(dated):
    picked = {"date_field": "start_date", "date_from": "2026-05-19", "date_to": "2026-05-19"}
    assert _dated(dated, "hiral", **picked) == set()
    assert _dated(dated, "vijay", **picked) == {"Payroll export for Vijay"}
