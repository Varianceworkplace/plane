/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { AddOutline, DeleteOutline, EditOutline, LockOutline, MoreHorizontalOutline } from "@makeplane/propel/icons";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import type { ProjectOption } from "@plane/blocks/property-select";
import { ProjectSelect } from "@plane/blocks/property-select";
import { setToast } from "@plane/blocks/toast";
// components
import { MemberSelect } from "@/components/dropdowns/member/member-select";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import {
  ACTION_LABELS,
  SCOPE_LABELS,
  accessControlService,
  fromMatrix,
  toMatrix,
  toastError,
  useTeams,
} from "./helpers";
import type { TPermissionMatrix } from "./helpers";
import { Person, usePersonName } from "./person";
import { PermissionGrid } from "./roles-tab";
import type { TAccessControl, TRbacAction, TTeam, TTeamScope } from "./types";

const useProjectOptions = () => {
  const { workspaceProjectIds, getProjectById } = useProject();
  const options = useMemo<ProjectOption[]>(
    () =>
      (workspaceProjectIds ?? [])
        .map((id) => getProjectById(id))
        .filter((project): project is NonNullable<typeof project> => !!project && !project.archived_at)
        .map((project) => ({
          id: project.id,
          name: project.name,
          identifier: project.identifier,
          logo_props: project.logo_props,
        })),
    [workspaceProjectIds, getProjectById]
  );
  const getValues = useCallback(
    async ({ search }: { search?: string }) => {
      const query = search?.trim().toLowerCase();
      const results = options.filter(
        (project) => !query || `${project.name} ${project.identifier ?? ""}`.toLowerCase().includes(query)
      );
      return { results, next_page_results: false };
    },
    [options]
  );
  return { options, getValues };
};

function Field(props: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-body-xs-medium text-secondary">{props.label}</span>
      <div className="rounded-md border-[0.5px] border-subtle">{props.children}</div>
      <span className="text-caption-md-regular text-tertiary">{props.hint}</span>
    </div>
  );
}

function TeamEditor(props: {
  open: boolean;
  workspaceSlug: string;
  team: TTeam | null;
  onClose: (saved: boolean) => void;
}) {
  const { open, workspaceSlug, team, onClose } = props;
  const { options: projectOptions, getValues } = useProjectOptions();
  const [name, setName] = useState("");
  const [leads, setLeads] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [nameError, setNameError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(team?.name ?? "");
    setLeads((team?.members ?? []).filter((m) => m.is_lead).map((m) => m.member_id));
    setMembers((team?.members ?? []).filter((m) => !m.is_lead).map((m) => m.member_id));
    setProjectIds(team?.project_ids ?? []);
    setNameError("");
  }, [open, team]);

  const save = async () => {
    if (!name.trim()) {
      setNameError("Give the team a name.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        // a lead picked as a member too stays a lead
        members: [
          ...leads.map((member_id) => ({ member_id, is_lead: true })),
          ...members.filter((id) => !leads.includes(id)).map((member_id) => ({ member_id, is_lead: false })),
        ],
        project_ids: projectIds,
      };
      if (team) await accessControlService.updateTeam(workspaceSlug, team.id, payload);
      else await accessControlService.createTeam(workspaceSlug, payload);
      setToast({ type: "success", title: team ? "Team updated" : "Team created", message: name.trim() });
      onClose(true);
    } catch (error) {
      const data = (error ?? {}) as Record<string, string>;
      if (data.name) setNameError(data.name);
      else toastError("Team not saved", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="lg">
        <div className="px-5 pt-5">
          <DialogTitle>{team ? `Edit ${team.name}` : "New team"}</DialogTitle>
        </div>
        <DialogMain>
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-body-xs-medium text-secondary">
                Name <span className="text-danger-primary">*</span>
              </span>
              <InputGroup size="md">
                <Input
                  size="md"
                  placeholder="e.g. Team A"
                  value={name}
                  aria-invalid={!!nameError || undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError("");
                  }}
                />
              </InputGroup>
              {nameError && <span className="text-caption-md-regular text-danger-primary">{nameError}</span>}
            </div>
            <Field
              label="Leads (PMs)"
              hint="The team's project managers: with the Project Manager role they manage the team's projects and work."
            >
              <MemberSelect
                multiple
                value={leads}
                onChange={setLeads}
                placeholder="Pick leads"
                variant="select-md"
                className="w-full"
              />
            </Field>
            <Field label="Members" hint="Their work is visible to the team's leads.">
              <MemberSelect
                multiple
                value={members}
                onChange={setMembers}
                excludeIds={leads}
                placeholder="Pick members"
                variant="select-md"
                className="w-full"
              />
            </Field>
            <Field label="Projects the team owns" hint="Several teams can own the same project.">
              <ProjectSelect
                multiple
                variant="select-md"
                className="w-full"
                getValues={getValues}
                value={projectOptions.filter((project) => projectIds.includes(project.id))}
                onChange={setProjectIds}
                placeholder="Pick projects"
                searchPlaceholder="Search projects"
              />
            </Field>
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label={team ? "Save changes" : "Create team"}
            loading={saving}
            onClick={() => void save()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** What the team's leads may do instead of what their roles grant, action by action. */
function LeadPermissionsEditor(props: {
  open: boolean;
  workspaceSlug: string;
  overview: TAccessControl;
  team: TTeam | null;
  onClose: (saved: boolean) => void;
}) {
  const { open, workspaceSlug, overview, team, onClose } = props;
  const personName = usePersonName();
  const [matrix, setMatrix] = useState<TPermissionMatrix<TTeamScope>>({});
  const [saving, setSaving] = useState(false);
  const leads = (team?.members ?? []).filter((m) => m.is_lead).map((m) => personName(m.member_id));

  useEffect(() => {
    if (open) setMatrix(toMatrix(team?.lead_permissions ?? []));
  }, [open, team]);

  const setScope = (module: string, action: TRbacAction, scope: TTeamScope | undefined) =>
    setMatrix((previous) => ({ ...previous, [module]: { ...previous[module], [action]: scope } }));

  const save = async () => {
    if (!team) return;
    setSaving(true);
    try {
      await accessControlService.updateTeam(workspaceSlug, team.id, { lead_permissions: fromMatrix(matrix) });
      setToast({ type: "success", title: "Lead permissions updated", message: team.name });
      onClose(true);
    } catch (error) {
      toastError("Lead permissions not saved", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="xl">
        <div className="px-5 pt-5">
          <DialogTitle>{`Lead permissions: ${team?.name ?? ""}`}</DialogTitle>
          <p className="mt-1 text-caption-md-regular text-tertiary">
            For the team&apos;s leads ({leads.length ? leads.join(", ") : "none yet"}). A setting here replaces what
            their roles grant for that action, more or less; Role default keeps the role&apos;s. The team&apos;s members
            keep their roles.
          </p>
        </div>
        <DialogMain>
          <div className="flex flex-col gap-4 px-5 py-4">
            <PermissionGrid<TTeamScope>
              overview={overview}
              matrix={matrix}
              onChange={setScope}
              inherit="Role default"
            />
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label="Save changes"
            loading={saving}
            onClick={() => void save()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** Teams with their leads, members, the projects they own and what their leads may do instead of their roles. */
export const AccessTeamsTab = observer(function AccessTeamsTab(props: {
  workspaceSlug: string;
  overview: TAccessControl;
}) {
  const { workspaceSlug, overview } = props;
  const { teams, mutate } = useTeams(workspaceSlug);
  const { getProjectById } = useProject();
  const personName = usePersonName();
  const [editing, setEditing] = useState<TTeam | null | undefined>(undefined);
  const [editingPermissions, setEditingPermissions] = useState<TTeam | null>(null);

  // the team's Lead permissions in the grid's order, e.g. "Worklogs and reports view: All"
  const permissionSummary = (team: TTeam) =>
    overview.modules.flatMap((module) =>
      overview.actions.flatMap((action) => {
        const scope = team.lead_permissions.find((p) => p.module === module.key && p.action === action)?.scope;
        if (!scope) return [];
        const label = scope === "none" ? "Not allowed" : SCOPE_LABELS[scope].label;
        return [`${module.label} ${ACTION_LABELS[action].toLowerCase()}: ${label}`];
      })
    );

  const remove = async (team: TTeam) => {
    try {
      await accessControlService.deleteTeam(workspaceSlug, team.id);
      setToast({ type: "success", title: "Team deleted", message: team.name });
      void mutate();
    } catch (error) {
      toastError("Team not deleted", error);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body-xs-regular text-tertiary">
          A team's leads are its PMs: they see the team members' work and manage the projects the team owns.
        </p>
        <Button
          stretch="auto"
          variant="primary"
          size="md"
          label="New team"
          icon={<Icon icon={AddOutline} />}
          onClick={() => setEditing(null)}
        />
      </div>
      {teams && teams.length === 0 ? (
        <div className="flex justify-center rounded-lg border-[0.5px] border-subtle py-10">
          <EmptyStateCompact
            title="No teams yet"
            description="Create a team for each PM and the people they manage."
            assetKey="project"
            assetClassName="size-16"
            align="center"
            actions={[{ label: "New team", onClick: () => setEditing(null) }]}
          />
        </div>
      ) : (
        <div className="flex flex-col rounded-lg border-[0.5px] border-subtle">
          {(teams ?? []).map((team) => {
            const leads = team.members.filter((m) => m.is_lead);
            const projects = team.project_ids.map((id) => getProjectById(id)?.name).filter(Boolean);
            return (
              <div
                key={team.id}
                className="flex items-start gap-4 border-b-[0.5px] border-subtle px-4 py-3 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <button
                    type="button"
                    className="w-fit text-body-sm-medium text-primary hover:underline"
                    onClick={() => setEditing(team)}
                  >
                    {team.name}
                  </button>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {leads.length ? (
                      leads.map((lead) => <Person key={lead.member_id} userId={lead.member_id} suffix="Lead" />)
                    ) : (
                      <span className="text-caption-md-regular text-warning-primary">No lead yet</span>
                    )}
                  </div>
                  <span className="text-caption-md-regular text-tertiary">
                    {team.members.length - leads.length}{" "}
                    {team.members.length - leads.length === 1 ? "member" : "members"}
                    {team.members.length - leads.length > 0 &&
                      `: ${team.members
                        .filter((m) => !m.is_lead)
                        .map((m) => personName(m.member_id))
                        .join(", ")}`}
                  </span>
                  <span className="text-caption-md-regular text-tertiary">
                    Owns: {projects.length ? projects.join(", ") : "no projects yet"}
                  </span>
                  {team.lead_permissions.length > 0 && (
                    <button
                      type="button"
                      className="w-fit text-left text-caption-md-regular text-tertiary hover:underline"
                      onClick={() => setEditingPermissions(team)}
                    >
                      Lead permissions: {permissionSummary(team).join(" · ")}
                    </button>
                  )}
                </div>
                <Menu>
                  <MenuTrigger
                    render={
                      <IconButton
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={MoreHorizontalOutline} />}
                        aria-label={`${team.name} options`}
                      />
                    }
                  />
                  <MenuContent side="bottom" align="end">
                    <MenuItem label="Edit" icon={<Icon icon={EditOutline} />} onClick={() => setEditing(team)} />
                    <MenuItem
                      label="Lead permissions"
                      icon={<Icon icon={LockOutline} />}
                      onClick={() => setEditingPermissions(team)}
                    />
                    <MenuItem label="Delete" icon={<Icon icon={DeleteOutline} />} onClick={() => void remove(team)} />
                  </MenuContent>
                </Menu>
              </div>
            );
          })}
        </div>
      )}
      <TeamEditor
        open={editing !== undefined}
        workspaceSlug={workspaceSlug}
        team={editing ?? null}
        onClose={(saved) => {
          setEditing(undefined);
          if (saved) void mutate();
        }}
      />
      <LeadPermissionsEditor
        open={!!editingPermissions}
        workspaceSlug={workspaceSlug}
        overview={overview}
        team={editingPermissions}
        onClose={(saved) => {
          setEditingPermissions(null);
          if (saved) void mutate();
        }}
      />
    </div>
  );
});
