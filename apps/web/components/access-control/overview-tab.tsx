/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Switch } from "@makeplane/propel/components/switch";
import { CheckDoneFilled } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { accessControlService, toastError, useAccessMembers, useRoles, useRolloutPreview, useTeams } from "./helpers";
import { RolloutPreview } from "./rollout-preview";
import type { TAccessControl } from "./types";

type Props = {
  workspaceSlug: string;
  overview: TAccessControl;
  onChanged: () => void;
  onOpenTab: (tab: string) => void;
};

function Step(props: { done: boolean; title: string; detail: string; action?: React.ReactNode }) {
  const { done, title, detail, action } = props;
  return (
    <li className="flex items-start gap-3 border-b-[0.5px] border-subtle py-3 last:border-b-0">
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
          done ? "text-success-primary" : "border-[1.5px] border-strong"
        )}
      >
        {done && <CheckDoneFilled className="size-5" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-sm-medium text-primary">{title}</span>
        <span className="text-body-xs-regular text-tertiary">{detail}</span>
      </span>
      {action}
    </li>
  );
}

/** The switch, and what to set up before turning it on. */
export const AccessOverviewTab = observer(function AccessOverviewTab(props: Props) {
  const { workspaceSlug, overview, onChanged, onOpenTab } = props;
  const { roles } = useRoles(workspaceSlug);
  const { teams } = useTeams(workspaceSlug);
  const { members } = useAccessMembers(workspaceSlug);
  const { mutate: refreshPreview } = useRolloutPreview(workspaceSlug);
  const { fetchWorkspaceAccess } = useUserPermissions();
  const [confirming, setConfirming] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const withRoles = (members ?? []).filter((member) => member.role_ids.length > 0).length;
  const withLead = (teams ?? []).filter((team) => team.members.some((m) => m.is_lead)).length;

  const save = async (enabled: boolean) => {
    setSaving(true);
    try {
      await accessControlService.setEnabled(workspaceSlug, enabled);
      setToast({
        type: "success",
        title: enabled ? "Role-based access is on" : "Role-based access is off",
        message: enabled
          ? "Project memberships are being updated for HR and PMs."
          : "Plane's own roles apply again; memberships added for roles are being removed.",
      });
      onChanged();
      // menus and buttons follow the switch straight away
      void fetchWorkspaceAccess(workspaceSlug);
      void refreshPreview();
      setConfirming(null);
    } catch (error) {
      toastError("Not changed", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-start gap-4 rounded-lg border-[0.5px] border-subtle p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2 text-body-md-medium text-primary">
            Role-based access
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-caption-sm-medium",
                overview.is_rbac_enabled ? "bg-success-subtle text-success-primary" : "bg-layer-1 text-tertiary"
              )}
            >
              {overview.is_rbac_enabled ? "On" : "Off"}
            </span>
          </span>
          <span className="text-body-xs-regular text-secondary">
            When on, what people see and do follows their roles and teams: HR sees everything, a PM their teams'
            projects and work, an employee only the work assigned to them. When off, Plane's own Admin / Member / Guest
            roles apply and nothing set up here has any effect.
          </span>
          {!overview.can_switch && (
            <span className="text-caption-md-regular text-tertiary">Only workspace admins can turn it on or off.</span>
          )}
        </div>
        <Switch
          size="md"
          checked={overview.is_rbac_enabled}
          onCheckedChange={(checked) => setConfirming(!!checked)}
          disabled={!overview.can_switch || saving}
          aria-label="Role-based access"
        />
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="text-body-sm-medium text-primary">
          {overview.is_rbac_enabled ? "Setup" : "Before turning it on"}
        </h3>
        <ol className="rounded-lg border-[0.5px] border-subtle px-4">
          <Step
            done={(roles ?? []).length >= 3}
            title="Check the roles"
            detail="HR, Project Manager and Employee are ready with default permissions; adjust them or add your own."
            action={
              <Button stretch="auto" variant="secondary" size="sm" label="Roles" onClick={() => onOpenTab("roles")} />
            }
          />
          <Step
            done={withLead > 0}
            title="Create teams and pick their leads"
            detail={`A team's lead is its PM. Add the projects each team owns. ${teams?.length ?? 0} teams, ${withLead} with a lead.`}
            action={
              <Button stretch="auto" variant="secondary" size="sm" label="Teams" onClick={() => onOpenTab("teams")} />
            }
          />
          <Step
            done={withRoles > 0}
            title="Give people their roles"
            detail={`People without a role see no projects until they're given one. ${withRoles} of ${members?.length ?? 0} people have a role.`}
            action={
              <Button stretch="auto" variant="secondary" size="sm" label="People" onClick={() => onOpenTab("people")} />
            }
          />
          <Step
            done={false}
            title="Check a few people's access"
            detail="Review the table below, then see exactly what someone can view and change, and why."
            action={
              <Button
                stretch="auto"
                variant="secondary"
                size="sm"
                label="Check access"
                onClick={() => onOpenTab("check")}
              />
            }
          />
        </ol>
      </section>

      <RolloutPreview workspaceSlug={workspaceSlug} />

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent size="sm">
          <div className="px-5 pt-5">
            <DialogTitle>{confirming ? "Turn on role-based access?" : "Turn off role-based access?"}</DialogTitle>
          </div>
          <DialogMain>
            <p className="px-5 py-4 text-body-sm-regular text-secondary">
              {confirming
                ? "Everyone's access changes right away: lists, projects, reports and exports follow their roles and teams. HR and PMs are added to the projects they manage. You can turn it off again at any time."
                : "Plane's own roles apply again and the project memberships added for roles are removed. Roles, teams and shares are kept for next time."}
            </p>
          </DialogMain>
          <DialogActions>
            <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => setConfirming(null)} />
            <Button
              stretch="auto"
              variant={confirming ? "primary" : "danger"}
              size="md"
              label={confirming ? "Turn on" : "Turn off"}
              loading={saving}
              onClick={() => confirming !== null && void save(confirming)}
            />
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
});
