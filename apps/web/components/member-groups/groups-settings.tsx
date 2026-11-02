/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { AddOutline, DeleteOutline, EditOutline, MoreHorizontalOutline } from "@makeplane/propel/icons";
import { EUserWorkspaceRoles } from "@plane/types";
import { EmptyStateCompact } from "@plane/blocks/empty-state";
import { setToast } from "@plane/blocks/toast";
// components
import { Person, usePersonName } from "@/components/access-control/person";
import { MemberSelect } from "@/components/dropdowns/member/member-select";
// hooks
import { useMember } from "@/hooks/store/use-member";
// local imports
import { memberGroupService, useMemberGroups } from "./helpers";
import type { TMemberGroup } from "./types";

const firstError = (error: unknown) => {
  const first = Object.values((error ?? {}) as Record<string, unknown>)[0];
  return typeof first === "string" ? first : "Something went wrong. Please try again.";
};

function GroupEditor(props: {
  open: boolean;
  workspaceSlug: string;
  group: TMemberGroup | null;
  onClose: (saved: boolean) => void;
}) {
  const { open, workspaceSlug, group, onClose } = props;
  const {
    workspace: { workspaceMemberIds, getWorkspaceMemberDetails },
  } = useMember();
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ name?: string; member_ids?: string }>({});
  const [saving, setSaving] = useState(false);
  // team members: active workspace members and admins, not guests
  const teamMemberIds = useMemo(
    () =>
      (workspaceMemberIds ?? []).filter((id) => {
        const member = getWorkspaceMemberDetails(id);
        return !!member?.is_active && (member.role ?? 0) >= EUserWorkspaceRoles.MEMBER;
      }),
    [workspaceMemberIds, getWorkspaceMemberDetails]
  );

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setMemberIds(group?.member_ids ?? []);
    setDescription(group?.description ?? "");
    setErrors({});
  }, [open, group]);

  const save = async () => {
    if (!name.trim()) {
      setErrors({ name: "Group name is required." });
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), member_ids: memberIds, description: description.trim() };
      if (group) await memberGroupService.update(workspaceSlug, group.id, payload);
      else await memberGroupService.create(workspaceSlug, payload);
      setToast({ type: "success", title: group ? "Group updated" : "Group created", message: name.trim() });
      onClose(true);
    } catch (error) {
      const data = (error ?? {}) as Record<string, string>;
      if (data.name || data.member_ids) setErrors({ name: data.name, member_ids: data.member_ids });
      else setToast({ type: "error", title: "Group not saved", message: firstError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="lg">
        <div className="px-5 pt-5">
          <DialogTitle>{group ? `Edit ${group.name}` : "New group"}</DialogTitle>
        </div>
        <DialogMain>
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-body-xs-medium text-secondary">
                Group name <span className="text-danger-primary">*</span>
              </span>
              <InputGroup size="md">
                <Input
                  size="md"
                  placeholder="e.g. PHP Group"
                  value={name}
                  maxLength={255}
                  aria-invalid={!!errors.name || undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    setErrors((current) => ({ ...current, name: undefined }));
                  }}
                />
              </InputGroup>
              {errors.name && <span className="text-caption-md-regular text-danger-primary">{errors.name}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-xs-medium text-secondary">Group members</span>
              <div className="rounded-md border-[0.5px] border-subtle">
                <MemberSelect
                  multiple
                  memberIds={teamMemberIds}
                  value={memberIds}
                  onChange={(ids) => {
                    setMemberIds(ids);
                    setErrors((current) => ({ ...current, member_ids: undefined }));
                  }}
                  placeholder="Pick team members"
                  variant="select-md"
                  className="w-full"
                />
              </div>
              <span className="text-caption-md-regular text-tertiary">
                Everyone in the group sees the project tasks assigned to it.
              </span>
              {errors.member_ids && (
                <span className="text-caption-md-regular text-danger-primary">{errors.member_ids}</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-xs-medium text-secondary">Description</span>
              <TextAreaGroup resize="none">
                <TextArea
                  size="md"
                  surface="field"
                  autoResize
                  maxRows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What the group works on"
                />
              </TextAreaGroup>
            </div>
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label={group ? "Save changes" : "Create group"}
            loading={saving}
            onClick={() => void save()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function DeleteGroupDialog(props: {
  workspaceSlug: string;
  group: TMemberGroup | null;
  onClose: (deleted: boolean) => void;
}) {
  const { workspaceSlug, group, onClose } = props;
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!group) return;
    setDeleting(true);
    try {
      await memberGroupService.remove(workspaceSlug, group.id);
      setToast({ type: "success", title: "Group deleted", message: group.name });
      onClose(true);
    } catch (error) {
      setToast({ type: "error", title: "Group not deleted", message: firstError(error) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={!!group} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="sm">
        <div className="px-5 pt-5">
          <DialogTitle>Delete {group?.name}?</DialogTitle>
        </div>
        <DialogMain>
          <p className="px-5 py-4 text-body-sm-regular text-secondary">
            {group?.task_count
              ? `${group.task_count} project ${group.task_count === 1 ? "task is" : "tasks are"} assigned to this group. ${group.task_count === 1 ? "It" : "They"} will no longer be assigned to anyone, and the group's members stop seeing ${group.task_count === 1 ? "it" : "them"}.`
              : "No project tasks are assigned to this group."}
          </p>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="danger"
            size="md"
            label="Delete group"
            loading={deleting}
            onClick={() => void remove()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** Workspace settings › Groups: groups of team members that project tasks can be assigned to. */
export const GroupsSettings = observer(function GroupsSettings(props: { workspaceSlug: string }) {
  const { workspaceSlug } = props;
  const { data, groups, mutate, isLoading } = useMemberGroups(workspaceSlug);
  const personName = usePersonName();
  const [editing, setEditing] = useState<TMemberGroup | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TMemberGroup | null>(null);
  const canCreate = !!data?.can_create;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-xs-regular text-tertiary">
          Pick a group in a project task's Assigned to: everyone in it sees the task.
        </p>
        {canCreate && (
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label="New group"
            icon={<Icon icon={AddOutline} />}
            onClick={() => setEditing(null)}
          />
        )}
      </div>
      {isLoading && !groups ? (
        <div className="h-24 animate-pulse rounded-lg bg-layer-1" />
      ) : !groups?.length ? (
        <div className="flex justify-center rounded-lg border-[0.5px] border-subtle py-10">
          <EmptyStateCompact
            title="No groups yet"
            description="Create a group, such as PHP Group, and add the team members who work on its tasks."
            assetKey="project"
            assetClassName="size-16"
            align="center"
            actions={canCreate ? [{ label: "New group", onClick: () => setEditing(null) }] : undefined}
          />
        </div>
      ) : (
        <div className="flex flex-col rounded-lg border-[0.5px] border-subtle">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-start gap-4 border-b-[0.5px] border-subtle px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {group.can_edit ? (
                  <button
                    type="button"
                    className="w-fit text-left text-body-sm-medium text-primary hover:underline"
                    onClick={() => setEditing(group)}
                  >
                    {group.name}
                  </button>
                ) : (
                  <span className="text-body-sm-medium text-primary">{group.name}</span>
                )}
                {group.description && (
                  <span className="text-body-xs-regular whitespace-pre-line text-secondary">{group.description}</span>
                )}
                <span className="text-caption-md-regular text-tertiary">
                  {group.member_ids.length} {group.member_ids.length === 1 ? "member" : "members"}
                  {group.member_ids.length > 0 && `: ${group.member_ids.map((id) => personName(id)).join(", ")}`}
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption-md-regular text-tertiary">
                  <span>
                    {group.task_count} project {group.task_count === 1 ? "task" : "tasks"} assigned
                  </span>
                  {group.created_by && (
                    <span className="flex items-center gap-1.5">
                      Created by <Person userId={group.created_by} />
                    </span>
                  )}
                </div>
              </div>
              {(group.can_edit || group.can_delete) && (
                <Menu>
                  <MenuTrigger
                    render={
                      <IconButton
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={MoreHorizontalOutline} />}
                        aria-label={`${group.name} options`}
                      />
                    }
                  />
                  <MenuContent side="bottom" align="end">
                    {group.can_edit && (
                      <MenuItem label="Edit" icon={<Icon icon={EditOutline} />} onClick={() => setEditing(group)} />
                    )}
                    {group.can_delete && (
                      <MenuItem
                        label="Delete"
                        icon={<Icon icon={DeleteOutline} />}
                        onClick={() => setDeleting(group)}
                      />
                    )}
                  </MenuContent>
                </Menu>
              )}
            </div>
          ))}
        </div>
      )}
      <GroupEditor
        open={editing !== undefined}
        workspaceSlug={workspaceSlug}
        group={editing ?? null}
        onClose={(saved) => {
          setEditing(undefined);
          if (saved) void mutate();
        }}
      />
      <DeleteGroupDialog
        workspaceSlug={workspaceSlug}
        group={deleting}
        onClose={(deleted) => {
          setDeleting(null);
          if (deleted) void mutate();
        }}
      />
    </div>
  );
});
