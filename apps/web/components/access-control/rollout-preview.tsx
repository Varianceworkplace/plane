/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { RefreshOutline, WarningTriangleOutline } from "@makeplane/propel/icons";
import { cn } from "@plane/utils";
// local imports
import { useRolloutPreview } from "./helpers";
import { Person, usePersonName } from "./person";

/** Per person: what role-based access gives them, next to what they have today (step 8: before switching on). */
export const RolloutPreview = observer(function RolloutPreview(props: { workspaceSlug: string }) {
  const { workspaceSlug } = props;
  const { preview, mutate, isLoading } = useRolloutPreview(workspaceSlug);
  const personName = usePersonName();

  if (!preview) return isLoading ? <div className="h-32 animate-pulse rounded-lg bg-layer-1" /> : null;

  const { warnings } = preview;
  const names = (ids: string[]) => ids.map(personName).join(", ");
  const notes = [
    warnings.without_role.length > 0 &&
      `${warnings.without_role.length} ${warnings.without_role.length === 1 ? "person has" : "people have"} no role yet, so no projects or project tasks until one is given: ${names(warnings.without_role)}.`,
    warnings.teams_without_lead.length > 0 &&
      `Teams without a lead (their members' work is seen only by HR and admins): ${warnings.teams_without_lead.join(", ")}.`,
    warnings.projects_without_team.length > 0 &&
      `Projects no team owns (only HR and admins can change them; no PM manages them): ${warnings.projects_without_team.join(", ")}.`,
    warnings.seeing_fewer_work_items.length > 0 &&
      `Will see fewer project tasks than today: ${names(warnings.seeing_fewer_work_items)}.`,
  ].filter((note): note is string => !!note);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-body-sm-medium text-primary">
            {preview.is_rbac_enabled ? "What each person gets" : "What changes when it's on"}
          </h3>
          <p className="text-body-xs-regular text-tertiary">
            {preview.is_rbac_enabled
              ? "From their roles, teams and shares, as it applies now."
              : "Worked out from today's roles, teams and shares. Nothing changes until you turn it on."}
          </p>
        </div>
        <Button
          stretch="auto"
          variant="secondary"
          size="sm"
          label="Refresh"
          icon={<Icon icon={RefreshOutline} />}
          onClick={() => void mutate()}
        />
      </div>

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-lg bg-warning-subtle px-4 py-3">
          {notes.map((note) => (
            <li key={note} className="flex items-start gap-2 text-body-xs-regular text-secondary">
              <WarningTriangleOutline className="mt-0.5 size-3.5 shrink-0 text-warning-primary" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
        <table className="w-full min-w-[720px] border-collapse text-body-xs-regular">
          <thead>
            <tr className="border-b-[0.5px] border-subtle bg-layer-1 text-left text-caption-md-medium text-tertiary">
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2">Teams</th>
              <th className="px-3 py-2">{preview.is_rbac_enabled ? "Project tasks" : "Project tasks: today → on"}</th>
              <th className="px-3 py-2">Projects: see · change</th>
              {!preview.is_rbac_enabled && <th className="px-3 py-2">Added to projects</th>}
            </tr>
          </thead>
          <tbody>
            {preview.people.map((person) => {
              const { now, after } = person.work_items;
              return (
                <tr key={person.member_id} className="border-b-[0.5px] border-subtle last:border-b-0">
                  <td className="px-3 py-2">
                    <Person userId={person.member_id} />
                  </td>
                  <td className="px-3 py-2 text-secondary">
                    {person.is_workspace_admin
                      ? "Workspace admin: everything"
                      : person.roles.join(", ") || <span className="text-placeholder">No role</span>}
                  </td>
                  <td className="px-3 py-2 text-secondary">
                    {person.teams.length ? (
                      person.teams.map((team) => `${team.name}${team.is_lead ? " (lead)" : ""}`).join(", ")
                    ) : (
                      <span className="text-placeholder">None</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {preview.is_rbac_enabled ? (
                      <span className="text-secondary">{after}</span>
                    ) : (
                      <span
                        className={cn(
                          "text-secondary",
                          after < now && "text-warning-primary",
                          after > now && "text-success-primary"
                        )}
                      >
                        {now} → {after}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-secondary">
                    {person.projects.view} · {person.projects.edit}
                  </td>
                  {!preview.is_rbac_enabled && (
                    <td className="px-3 py-2 text-secondary">
                      {person.memberships.added + person.memberships.raised > 0 ? (
                        [
                          person.memberships.added > 0 && `${person.memberships.added} added`,
                          person.memberships.raised > 0 && `${person.memberships.raised} raised to admin`,
                        ]
                          .filter(Boolean)
                          .join(", ")
                      ) : (
                        <span className="text-placeholder">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
});
