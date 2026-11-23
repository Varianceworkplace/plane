/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { mutate as globalMutate } from "swr";
// plane imports
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { SearchOutline } from "@makeplane/propel/icons";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
// local imports
import {
  WORKSPACE_ROLE_LABELS,
  accessControlService,
  accessKeys,
  toastError,
  useAccessMembers,
  useRoles,
  useTeams,
} from "./helpers";
import {
  DeleteMemberDialog,
  MemberActionsMenu,
  MemberStatusBadge,
  MemberStatusDialog,
  ResetPasswordDialog,
} from "./member-status";
import { Person, usePersonName } from "./person";
import type { TRole } from "./types";

type TStatusFilter = "all" | "active" | "disabled";
const STATUS_FILTERS: { key: TStatusFilter; label: string }[] = [
  { key: "all", label: "All people" },
  { key: "active", label: "Active" },
  { key: "disabled", label: "Disabled" },
];

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

/** Everyone in the workspace: their Plane role, the roles they hold here, their teams, and whether they're active
 * (Disable, Enable and Delete permanently for HR and workspace admins). */
export const AccessPeopleTab = observer(function AccessPeopleTab(props: { workspaceSlug: string }) {
  const { workspaceSlug } = props;
  const { members, mutate } = useAccessMembers(workspaceSlug, true, true);
  const { roles, mutate: mutateRoles } = useRoles(workspaceSlug);
  const { teams } = useTeams(workspaceSlug);
  const {
    workspace: { fetchWorkspaceMembers },
  } = useMember();
  const personName = usePersonName();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TStatusFilter>("all");
  const [statusChange, setStatusChange] = useState<{ mode: "disable" | "enable"; memberId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState<string | null>(null);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = (members ?? [])
      .map((member) => Object.assign({ name: personName(member.member_id) }, member))
      .filter((member) => !query || member.name.toLowerCase().includes(query))
      .filter((member) => {
        const active = member.is_active !== false;
        return statusFilter === "all" || (statusFilter === "active") === active;
      });
    // active people first, then by name
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the new list built above, not the store's
    return matches.sort(
      (a, b) => Number(a.is_active === false) - Number(b.is_active === false) || a.name.localeCompare(b.name)
    );
  }, [members, search, personName, statusFilter]);
  const disabledCount = (members ?? []).filter((member) => member.is_active === false).length;

  // People tab, Overview and every member picker (disabled people show there as suspended)
  const refreshEverywhere = async () => {
    await mutate();
    void globalMutate(accessKeys.members(workspaceSlug));
    void mutateRoles();
    await fetchWorkspaceMembers(workspaceSlug).catch(() => undefined);
  };

  const changeStatus = async () => {
    if (!statusChange) return;
    const { mode, memberId } = statusChange;
    const name = personName(memberId);
    setBusy(true);
    try {
      if (mode === "disable") await accessControlService.disableMember(workspaceSlug, memberId);
      else await accessControlService.enableMember(workspaceSlug, memberId);
      setToast({
        type: "success",
        title: mode === "disable" ? `${name} is disabled` : `${name} is active again`,
        message:
          mode === "disable" ? "They were signed out and can't sign in until enabled." : "They can sign in again.",
      });
      setStatusChange(null);
      await refreshEverywhere();
    } catch (error) {
      toastError(mode === "disable" ? "Not disabled" : "Not enabled", error);
    } finally {
      setBusy(false);
    }
  };

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
          Disabled people can't sign in; their work stays until they're deleted.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <div className="w-40 rounded-md border-[0.5px] border-subtle">
            <Select<{ key: TStatusFilter; label: string }>
              getValues={() => STATUS_FILTERS}
              value={STATUS_FILTERS.find((option) => option.key === statusFilter) ?? null}
              onChange={(key) => setStatusFilter(key as TStatusFilter)}
              placeholder="Show people"
              getOptionValue={(option) => option.key}
              getOptionLabel={(option) =>
                option.key === "disabled" && disabledCount ? `${option.label} (${disabledCount})` : option.label
              }
              showSearch={false}
              pinSelected={false}
            >
              <Select.Trigger<{ key: TStatusFilter; label: string }>
                variant="select-md"
                className="w-full"
                aria-label="Show people"
              >
                <span className="truncate text-left">
                  {STATUS_FILTERS.find((option) => option.key === statusFilter)?.label}
                  {statusFilter === "disabled" && disabledCount ? ` (${disabledCount})` : ""}
                </span>
              </Select.Trigger>
            </Select>
          </div>
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
      </div>
      <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
        <table className="w-full min-w-[820px] border-collapse text-body-xs-regular">
          <thead>
            <tr className="border-b-[0.5px] border-subtle bg-layer-1 text-left text-caption-md-medium text-tertiary">
              <th className="px-4 py-2">Person</th>
              <th className="px-3 py-2">Variance role</th>
              <th className="w-72 px-3 py-2">Roles</th>
              <th className="px-3 py-2">Teams</th>
              <th className="px-3 py-2">Status</th>
              <th className="w-10 px-2 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((member) => (
              <tr
                key={member.member_id}
                className={cn(
                  "border-b-[0.5px] border-subtle last:border-b-0",
                  member.is_active === false && "bg-layer-1 text-tertiary"
                )}
              >
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
                <td className="px-3 py-2">
                  <MemberStatusBadge active={member.is_active !== false} />
                </td>
                <td className="px-2 py-2 text-right">
                  <MemberActionsMenu
                    member={member}
                    name={member.name}
                    onDisable={() => setStatusChange({ mode: "disable", memberId: member.member_id })}
                    onEnable={() => setStatusChange({ mode: "enable", memberId: member.member_id })}
                    onDelete={() => setDeleting(member.member_id)}
                    onResetPassword={() => setResettingPassword(member.member_id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-4 py-6 text-center text-body-xs-regular text-tertiary">
            {statusFilter === "disabled" ? "No one is disabled." : "No one matches."}
          </p>
        )}
      </div>
      <MemberStatusDialog
        mode={statusChange?.mode ?? null}
        name={statusChange ? personName(statusChange.memberId) : ""}
        busy={busy}
        onClose={() => setStatusChange(null)}
        onConfirm={() => void changeStatus()}
      />
      <ResetPasswordDialog
        workspaceSlug={workspaceSlug}
        memberId={resettingPassword}
        name={resettingPassword ? personName(resettingPassword) : ""}
        onClose={() => setResettingPassword(null)}
      />
      <DeleteMemberDialog
        workspaceSlug={workspaceSlug}
        memberId={deleting}
        name={deleting ? personName(deleting) : ""}
        onClose={(deleted) => {
          setDeleting(null);
          if (deleted) void refreshEverywhere();
        }}
      />
    </div>
  );
});
