/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { SearchOutline } from "@makeplane/propel/icons";
import { Select } from "@plane/blocks/select";
// local imports
import {
  WORKSPACE_ROLE_LABELS,
  accessControlService,
  toastError,
  useAccessMembers,
  useRoles,
  useTeams,
} from "./helpers";
import { Person, usePersonName } from "./person";
import type { TRole } from "./types";

function RolesSelect(props: { roles: TRole[]; value: string[]; onChange: (ids: string[]) => void; label: string }) {
  const { roles, value, onChange, label } = props;
  const selected = roles.filter((role) => value.includes(role.id));
  return (
    <Select<TRole>
      multiple
      getValues={() => roles}
      value={selected}
      onChange={onChange}
      getOptionValue={(role) => role.id}
      getOptionLabel={(role) => role.name}
      showSearch={roles.length > 8}
      pinSelected={false}
    >
      <Select.Trigger<TRole> variant="select-md" className="w-full" aria-label={label}>
        {(items) => (
          <span className="truncate text-left">
            {items.length ? (
              items.map((role) => role.name).join(", ")
            ) : (
              <span className="text-placeholder">No role</span>
            )}
          </span>
        )}
      </Select.Trigger>
    </Select>
  );
}

/** Everyone in the workspace: their Plane role, the roles they hold here, and their teams. */
export const AccessPeopleTab = observer(function AccessPeopleTab(props: { workspaceSlug: string }) {
  const { workspaceSlug } = props;
  const { members, mutate } = useAccessMembers(workspaceSlug);
  const { roles, mutate: mutateRoles } = useRoles(workspaceSlug);
  const { teams } = useTeams(workspaceSlug);
  const personName = usePersonName();
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = (members ?? [])
      .map((member) => Object.assign({ name: personName(member.member_id) }, member))
      .filter((member) => !query || member.name.toLowerCase().includes(query));
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the new list built above, not the store's
    return matches.sort((a, b) => a.name.localeCompare(b.name));
  }, [members, search, personName]);

  const setRoles = async (memberId: string, roleIds: string[]) => {
    // show it right away, put it back if the server refuses
    const previous = members;
    await mutate(
      (members ?? []).map((m) => (m.member_id === memberId ? Object.assign({}, m, { role_ids: roleIds }) : m)),
      { revalidate: false }
    );
    try {
      await accessControlService.setMemberRoles(workspaceSlug, memberId, roleIds);
      void mutateRoles();
    } catch (error) {
      await mutate(previous, { revalidate: false });
      toastError("Roles not changed", error);
    }
  };

  const teamName = (teamId: string) => teams?.find((team) => team.id === teamId)?.name ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body-xs-regular text-tertiary">
          Workspace admins always have full access. People without a role see no projects until they're given one.
        </p>
        <div className="w-56 shrink-0">
          <InputGroup size="md">
            <span className="flex items-center pl-2 text-tertiary">
              <SearchOutline className="size-3.5" />
            </span>
            <Input
              size="md"
              aria-label="Search people"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
        <table className="w-full min-w-[720px] border-collapse text-body-xs-regular">
          <thead>
            <tr className="border-b-[0.5px] border-subtle bg-layer-1 text-left text-caption-md-medium text-tertiary">
              <th className="px-4 py-2">Person</th>
              <th className="px-3 py-2">Variance role</th>
              <th className="w-72 px-3 py-2">Roles</th>
              <th className="px-3 py-2">Teams</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((member) => (
              <tr key={member.member_id} className="border-b-[0.5px] border-subtle last:border-b-0">
                <td className="px-4 py-2">
                  <Person userId={member.member_id} />
                </td>
                <td className="px-3 py-2 text-secondary">{WORKSPACE_ROLE_LABELS[member.workspace_role] ?? "—"}</td>
                <td className="px-3 py-2">
                  {member.workspace_role === 20 ? (
                    <span className="text-caption-md-regular text-tertiary">Full access (workspace admin)</span>
                  ) : (
                    <div className="rounded-md border-[0.5px] border-subtle">
                      <RolesSelect
                        roles={roles ?? []}
                        value={member.role_ids}
                        onChange={(ids) => void setRoles(member.member_id, ids)}
                        label={`Roles of ${member.name}`}
                      />
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-secondary">
                  {member.teams.length ? (
                    member.teams.map((t) => `${teamName(t.team_id)}${t.is_lead ? " (lead)" : ""}`).join(", ")
                  ) : (
                    <span className="text-placeholder">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
