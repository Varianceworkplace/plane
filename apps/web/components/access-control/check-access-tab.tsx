/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// components
import { MemberSelect } from "@/components/dropdowns/member/member-select";
// local imports
import { ACTION_LABELS, SCOPE_LABELS, accessControlService } from "./helpers";
import type { TAccessControl } from "./types";

/** Pick a person: what they may do and see, and why. */
export const AccessCheckTab = observer(function AccessCheckTab(props: {
  workspaceSlug: string;
  overview: TAccessControl;
}) {
  const { workspaceSlug, overview } = props;
  const [memberId, setMemberId] = useState<string | null>(null);
  const { data: check, isLoading } = useSWR(memberId ? `ACCESS_CHECK_${memberId}` : null, () =>
    accessControlService.checkAccess(workspaceSlug, memberId as string)
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-body-xs-medium text-secondary">Check the access of</span>
        <div className="w-64 rounded-md border-[0.5px] border-subtle">
          <MemberSelect
            value={memberId}
            onChange={(id) => setMemberId(id || null)}
            placeholder="Pick a person"
            variant="select-md"
            className="w-full"
          />
        </div>
        {check && !check.is_rbac_enabled && (
          <span className="text-caption-md-regular text-warning-primary">
            Role-based access is off: this is what they'll get once it's on.
          </span>
        )}
      </div>

      {isLoading && <div className="h-32 animate-pulse rounded-lg bg-layer-1" />}

      {check && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border-[0.5px] border-subtle p-3">
              <span className="text-caption-md-regular text-tertiary">Roles</span>
              <p className="text-body-sm-medium text-primary">
                {check.is_workspace_admin ? "Workspace admin: full access" : check.roles.join(", ")}
              </p>
            </div>
            <div className="rounded-lg border-[0.5px] border-subtle p-3">
              <span className="text-caption-md-regular text-tertiary">Teams</span>
              <p className="text-body-sm-medium text-primary">
                {check.teams.length
                  ? check.teams.map((team) => `${team.name}${team.is_lead ? " (lead)" : ""}`).join(", ")
                  : "None"}
              </p>
            </div>
            <div className="rounded-lg border-[0.5px] border-subtle p-3">
              <span className="text-caption-md-regular text-tertiary">Projects they can see · change</span>
              <p className="text-body-sm-medium text-primary">
                {check.projects.view.length} · {check.projects.edit.length}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
            <table className="w-full min-w-[600px] border-collapse text-body-xs-regular">
              <thead>
                <tr className="border-b-[0.5px] border-subtle bg-layer-1 text-left text-caption-md-medium text-tertiary">
                  <th className="px-3 py-2">Module</th>
                  {overview.actions.map((action) => (
                    <th key={action} className="px-3 py-2">
                      {ACTION_LABELS[action]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overview.modules.map((module) => (
                  <tr key={module.key} className="border-b-[0.5px] border-subtle last:border-b-0">
                    <td className="px-3 py-2 font-medium whitespace-nowrap text-primary">{module.label}</td>
                    {overview.actions.map((action) => {
                      const scopes = check.permissions[module.key]?.[action] ?? [];
                      const fromTeams = check.team_permissions?.[module.key]?.[action];
                      return (
                        <td key={action} className="px-3 py-2">
                          {scopes.length ? (
                            <span className="text-secondary">
                              {scopes.map((scope) => SCOPE_LABELS[scope].label).join(" + ")}
                            </span>
                          ) : (
                            <span className="text-placeholder">—</span>
                          )}
                          {fromTeams && <span className="text-tertiary"> · {fromTeams.join(", ")}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(check.team_permissions ?? {}).length > 0 && (
            <p className="-mt-2 text-caption-md-regular text-tertiary">
              · Team name: set by that team&apos;s Lead permissions (Teams tab) instead of their role.
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ["Projects they can see", check.projects.view],
                ["Projects they can change", check.projects.edit],
              ] as const
            ).map(([title, names]) => (
              <div key={title} className="rounded-lg border-[0.5px] border-subtle p-3">
                <span className="text-caption-md-medium text-tertiary">{title}</span>
                <p className="mt-1 text-body-xs-regular text-secondary">{names.length ? names.join(", ") : "None"}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
});
