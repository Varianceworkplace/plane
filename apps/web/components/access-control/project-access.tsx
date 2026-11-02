/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { CalendarOutline, CloseOutline, MembersOutline } from "@makeplane/propel/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
import { renderFormattedDate } from "@plane/utils";
// components
import { MemberSelect } from "@/components/dropdowns/member/member-select";
// local imports
import { accessControlService, accessKeys, toastError } from "./helpers";
import { Person } from "./person";
import type { TAccessGrant } from "./types";

type TOption = { id: string; label: string };
const LEVELS: TOption[] = [
  { id: "view", label: "View only" },
  { id: "manage", label: "Manage" },
];
const TARGETS: TOption[] = [
  { id: "member", label: "A person" },
  { id: "team", label: "A team" },
];

function PlainSelect(props: { options: TOption[]; value: string; onChange: (id: string) => void; label: string }) {
  const { options, value, onChange, label } = props;
  const selected = options.find((option) => option.id === value) ?? null;
  return (
    <Select<TOption>
      getValues={() => options}
      value={selected}
      onChange={onChange}
      getOptionValue={(option) => option.id}
      getOptionLabel={(option) => option.label}
      showSearch={options.length > 8}
      pinSelected={false}
    >
      <Select.Trigger<TOption> variant="select-md" className="w-full" aria-label={label}>
        <span className={selected ? "truncate text-left" : "truncate text-left text-placeholder"}>
          {selected?.label ?? label}
        </span>
      </Select.Trigger>
    </Select>
  );
}

/** Project settings › Access: the teams that own the project and who it's shared with. */
export const ProjectAccess = observer(function ProjectAccess(props: { workspaceSlug: string; projectId: string }) {
  const { workspaceSlug, projectId } = props;
  const { data: access, mutate } = useSWR(accessKeys.project(projectId), () =>
    accessControlService.projectAccess(workspaceSlug, projectId)
  );
  const { data: teams } = useSWR(access?.can_share ? `ACCESS_PROJECT_TEAMS_${workspaceSlug}` : null, () =>
    accessControlService.teams(workspaceSlug).catch(() => [])
  );
  const [target, setTarget] = useState("member");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState("");
  const [level, setLevel] = useState("view");
  const [until, setUntil] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  if (!access) return <div className="h-32 animate-pulse rounded-lg bg-layer-1" />;

  const teamName = (id: string | null) => teams?.find((team) => team.id === id)?.name ?? "A team";

  const share = async () => {
    const who = target === "member" ? memberId : teamId;
    if (!who) {
      setToast({ type: "error", title: "Pick who to share with", message: "Choose a person or a team." });
      return;
    }
    setSaving(true);
    try {
      await accessControlService.shareProject(workspaceSlug, projectId, {
        ...(target === "member" ? { member_id: who } : { team_id: who }),
        level: level as TAccessGrant["level"],
        // shared until the end of that day
        expires_at: until
          ? new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59).toISOString()
          : null,
      });
      setToast({ type: "success", title: "Project shared", message: "Their access is being updated." });
      setMemberId(null);
      setTeamId("");
      setUntil(null);
      void mutate();
    } catch (error) {
      toastError("Not shared", error);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (grant: TAccessGrant) => {
    try {
      await accessControlService.removeShare(workspaceSlug, projectId, grant.id);
      void mutate();
    } catch (error) {
      toastError("Share not removed", error);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {!access.is_rbac_enabled && (
        <p className="rounded-md bg-layer-1 px-3 py-2 text-body-xs-regular text-secondary">
          Role-based access is off in this workspace: owning teams and shares take effect once it is turned on.
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-body-sm-medium text-primary">Teams that own this project</h3>
        <p className="text-body-xs-regular text-tertiary">
          Their leads (PMs) manage the project and see their team members' work in it. Change them in{" "}
          <Link href={`/${workspaceSlug}/settings/access-control`} className="text-accent-primary hover:underline">
            Workspace settings › Access control
          </Link>
          .
        </p>
        <div className="flex flex-wrap gap-2">
          {access.teams.length ? (
            access.teams.map((team) => (
              <span
                key={team.id}
                className="inline-flex items-center gap-1.5 rounded-sm border-[0.5px] border-strong px-2 py-1 text-caption-md-regular text-secondary"
              >
                <MembersOutline className="size-3.5" />
                {team.name}
              </span>
            ))
          ) : (
            <span className="text-body-xs-regular text-placeholder">No team owns it yet</span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-body-sm-medium text-primary">Shared with</h3>
        <p className="text-body-xs-regular text-tertiary">
          Give a person or another team access: view only, or manage (edit the project and its work). A share can end on
          a date.
        </p>
        <div className="flex flex-col rounded-lg border-[0.5px] border-subtle">
          {access.grants.length === 0 && (
            <p className="px-4 py-3 text-body-xs-regular text-placeholder">Not shared with anyone</p>
          )}
          {access.grants.map((grant) => (
            <div
              key={grant.id}
              className="flex items-center gap-3 border-b-[0.5px] border-subtle px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                {grant.member_id ? (
                  <Person userId={grant.member_id} />
                ) : (
                  <span className="flex items-center gap-2 text-body-xs-medium text-primary">
                    <MembersOutline className="size-4 text-tertiary" />
                    {teamName(grant.team_id)}
                  </span>
                )}
              </div>
              <span className="rounded-sm bg-layer-1 px-1.5 py-0.5 text-caption-sm-medium text-secondary">
                {grant.level === "manage" ? "Manage" : "View only"}
              </span>
              <span className="w-32 text-right text-caption-md-regular text-tertiary">
                {grant.expires_at ? `until ${renderFormattedDate(grant.expires_at)}` : "No end date"}
              </span>
              {access.can_share && (
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={CloseOutline} />}
                  aria-label="Remove this share"
                  onClick={() => void remove(grant)}
                />
              )}
            </div>
          ))}
        </div>

        {access.can_share ? (
          <div className="mt-2 grid grid-cols-1 items-end gap-2 rounded-lg border-[0.5px] border-subtle p-3 sm:grid-cols-[140px_1fr_140px_170px_auto]">
            <div className="rounded-md border-[0.5px] border-subtle">
              <PlainSelect options={TARGETS} value={target} onChange={setTarget} label="Share with" />
            </div>
            <div className="rounded-md border-[0.5px] border-subtle">
              {target === "member" ? (
                <MemberSelect
                  value={memberId}
                  onChange={(id) => setMemberId(id || null)}
                  placeholder="Pick a person"
                  variant="select-md"
                  className="w-full"
                />
              ) : (
                <PlainSelect
                  options={(teams ?? []).map((team) => ({ id: team.id, label: team.name }))}
                  value={teamId}
                  onChange={setTeamId}
                  label="Pick a team"
                />
              )}
            </div>
            <div className="rounded-md border-[0.5px] border-subtle">
              <PlainSelect options={LEVELS} value={level} onChange={setLevel} label="Access" />
            </div>
            <div className="rounded-md border-[0.5px] border-subtle">
              <DateSelect
                variant="select-md"
                className="w-full"
                value={until}
                onChange={setUntil}
                minDate={new Date()}
                placeholder="No end date"
                icon={<CalendarOutline />}
                clearable
              />
            </div>
            <Button
              stretch="auto"
              variant="primary"
              size="md"
              label="Share"
              loading={saving}
              onClick={() => void share()}
            />
          </div>
        ) : (
          <p className="text-caption-md-regular text-tertiary">Only people who may edit this project can share it.</p>
        )}
      </section>
    </div>
  );
});
