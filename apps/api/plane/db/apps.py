# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import os

from django.apps import AppConfig
from django.db.backends.signals import connection_created


def turn_off_jit(sender, connection, **kwargs):
    """PostgreSQL's JIT compiler (on by default) starts for any query the planner estimates as expensive. Plane's list
    queries (work items with their counts, the access rules' subqueries) are estimated far above that line though they
    run in milliseconds, so each paid seconds of compiling: an employee's Project Tasks page took 2.4 s, 0.02 s of it
    running the query. Off for this app's connections (the database's own setting is untouched); DB_JIT=on keeps it.
    Per connection rather than a startup option, so it works behind a connection pooler too."""
    if connection.vendor != "postgresql" or os.environ.get("DB_JIT", "off").lower() == "on":
        return
    with connection.cursor() as cursor:
        cursor.execute("SET jit = off")


class DbConfig(AppConfig):
    name = "plane.db"

    def ready(self):
        connection_created.connect(turn_off_jit, dispatch_uid="plane.db.turn_off_jit")
