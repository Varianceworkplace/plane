/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// plane imports
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import {
  BlockingOutline,
  CopyOutline,
  DeleteOutline,
  KeyOutline,
  MailOutline,
  MoreHorizontalOutline,
  UnlockedOutline,
  WarningTriangleOutline,
} from "@makeplane/propel/icons";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
import { copyTextToClipboard } from "@plane/utils";
// components
import { formatWorklogDuration } from "@/components/worklogs/helpers";
// hooks
import { useInstance } from "@/hooks/store/use-instance";
// local imports
import { accessControlService, toastError } from "./helpers";
import { usePersonName } from "./person";
import type { TAccessMember } from "./types";

const CONFIRM_WORD = "DELETE";

/** Active / Disabled, next to the person's name. */
export function MemberStatusBadge(props: { active: boolean }) {
  return props.active ? (
    <Badge variant="success" size="sm" label="Active" />
  ) : (
    <Badge variant="danger" size="sm" label="Disabled" />
  );
}

/** The ⋯ menu on a person's row: Reset password / Disable, or Enable / Delete permanently once disabled. */
export function MemberActionsMenu(props: {
  member: TAccessMember;
  name: string;
  onDisable: () => void;
  onEnable: () => void;
  onDelete: () => void;
  onResetPassword: () => void;
}) {
  const { member, name, onDisable, onEnable, onDelete, onResetPassword } = props;
  if (!member.can_remove) return null;
  const active = member.is_active !== false;
  return (
    <Menu>
      <MenuTrigger
        render={
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={MoreHorizontalOutline} />}
            aria-label={`Actions for ${name}`}
          />
        }
      />
      <MenuContent side="bottom" align="end">
        {active ? (
          <>
            <MenuItem label="Reset password" icon={<Icon icon={KeyOutline} />} onClick={onResetPassword} />
            <MenuItem label="Disable" icon={<Icon icon={BlockingOutline} />} onClick={onDisable} />
          </>
        ) : (
          <>
            <MenuItem label="Enable" icon={<Icon icon={UnlockedOutline} />} onClick={onEnable} />
            <MenuItem label="Delete permanently" icon={<Icon icon={DeleteOutline} />} onClick={onDelete} />
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

/** "Disable Neha?" / "Enable Neha?" */
export function MemberStatusDialog(props: {
  mode: "disable" | "enable" | null;
  name: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { mode, name, busy, onClose, onConfirm } = props;
  const disabling = mode === "disable";
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>{disabling ? `Disable ${name}?` : `Enable ${name}?`}</DialogTitle>
        </div>
        <DialogMain>
          <div className="px-5 py-4 text-body-xs-regular text-secondary">
            {disabling ? (
              <ul className="list-disc space-y-1 pl-4">
                <li>They&apos;re signed out right away and can&apos;t sign in to Variance until enabled.</li>
                <li>They can no longer be assigned to tasks or projects.</li>
                <li>Nothing is deleted: their tasks, time entries, roles and teams stay as they are.</li>
              </ul>
            ) : (
              <p>They can sign in again, with the same roles, teams and projects as before.</p>
            )}
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={onClose} />
          <Button
            stretch="auto"
            variant={disabling ? "danger" : "primary"}
            size="md"
            label={disabling ? "Disable" : "Enable"}
            loading={busy}
            onClick={onConfirm}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

type TPersonOption = { id: string; name: string };

/** Delete permanently: who takes over their work, what moves and what goes, and a typed confirmation. */
export const DeleteMemberDialog = observer(function DeleteMemberDialog(props: {
  workspaceSlug: string;
  memberId: string | null;
  name: string;
  onClose: (deleted: boolean) => void;
}) {
  const { workspaceSlug, memberId, name, onClose } = props;
  const personName = usePersonName();
  const { data: summary, error } = useSWR(
    memberId ? `ACCESS_MEMBER_DELETION_${memberId}` : null,
    () => accessControlService.memberDeletionSummary(workspaceSlug, memberId ?? ""),
    { revalidateOnFocus: false }
  );
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  // a fresh start each time the dialog opens
  useEffect(() => {
    setTransferTo(null);
    setConfirmText("");
  }, [memberId]);

  const options: TPersonOption[] = (summary?.transfer_to_ids ?? [])
    .map((id) => ({ id, name: personName(id) }))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the new list built above
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected = options.find((option) => option.id === transferTo) ?? null;
  const blocker = summary?.blocker ?? null;
  const ready = !!summary && !blocker && !!transferTo && confirmText.trim() === CONFIRM_WORD;

  const remove = async () => {
    if (!memberId || !transferTo) return;
    setBusy(true);
    try {
      await accessControlService.deleteMember(workspaceSlug, memberId, transferTo);
      setToast({
        type: "success",
        title: `${name} was deleted`,
        message: `Their work now belongs to ${selected?.name ?? "the person you picked"}.`,
      });
      onClose(true);
    } catch (err) {
      toastError("Not deleted", err);
    } finally {
      setBusy(false);
    }
  };

  const moves = summary
    ? [
        [summary.transfer.projects_created, "project(s) they created"],
        [summary.transfer.projects_led, "project(s) they lead"],
        [summary.transfer.tasks_assigned, "task(s) assigned to them"],
        [summary.transfer.tasks_created, "task(s) they created"],
        [summary.transfer.comments, "comment(s)"],
        [summary.transfer.pages, "page(s)"],
      ].filter(([count]) => Number(count) > 0)
    : [];

  return (
    <Dialog open={memberId !== null} onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent size="lg">
        <div className="px-5 pt-5">
          <DialogTitle>{`Delete ${name} permanently?`}</DialogTitle>
          <p className="mt-1 text-caption-md-regular text-tertiary">This can&apos;t be undone.</p>
        </div>
        <DialogMain>
          <div className="flex flex-col gap-4 px-5 py-4 text-body-xs-regular text-secondary">
            {error && <p className="text-danger-primary">Couldn&apos;t load what this would change. Try again.</p>}
            {!summary && !error && <p className="text-tertiary">Loading…</p>}
            {blocker && (
              <p className="flex items-start gap-2 rounded-md border-[0.5px] border-subtle bg-layer-1 p-3 text-primary">
                <WarningTriangleOutline className="mt-0.5 size-4 shrink-0" />
                {blocker}
              </p>
            )}
            {summary && !blocker && (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption-md-medium text-primary">Who takes over their work?</span>
                  <div className="rounded-md border-[0.5px] border-subtle">
                    <Select<TPersonOption>
                      getValues={() => options}
                      value={selected}
                      onChange={(id) => setTransferTo(id as string)}
                      placeholder="Takes over their work"
                      getOptionValue={(option) => option.id}
                      getOptionLabel={(option) => option.name}
                      showSearch={options.length > 8}
                      pinSelected={false}
                    >
                      <Select.Trigger<TPersonOption>
                        variant="select-md"
                        className="w-full"
                        aria-label="Takes over their work"
                      >
                        <span className="truncate text-left">
                          {selected?.name ?? <span className="text-placeholder">Pick a person</span>}
                        </span>
                      </Select.Trigger>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-caption-md-medium text-primary">
                    Moves to {selected?.name ?? "the person you pick"}
                  </span>
                  {moves.length ? (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {moves.map(([count, label]) => (
                        <li key={String(label)}>{`${count} ${label}`}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-tertiary">Nothing to move.</p>
                  )}
                  <p className="text-caption-md-regular text-tertiary">
                    They also become a member of the projects {name} was in, so they can open their work.
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-caption-md-medium text-primary">Deleted with {name}</span>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li>
                      {summary.delete.time_entries
                        ? `${summary.delete.time_entries} time entr${summary.delete.time_entries === 1 ? "y" : "ies"} (${formatWorklogDuration(summary.delete.time_minutes)}) — project hours drop by this`
                        : "No time entries"}
                      {summary.delete.running_timer ? ", and their running timer" : ""}
                    </li>
                    <li>
                      {`Their account, ${summary.delete.roles} role(s), ${summary.delete.teams} team(s), ${summary.delete.project_memberships} project membership(s)`}
                    </li>
                    <li>Their notifications, drafts, favourites and personal settings</li>
                  </ul>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="confirm-delete-member" className="text-caption-md-medium text-primary">
                    {`Type ${CONFIRM_WORD} to confirm`}
                  </label>
                  <InputGroup size="md">
                    <Input
                      id="confirm-delete-member"
                      size="md"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={CONFIRM_WORD}
                      autoComplete="off"
                    />
                  </InputGroup>
                </div>
              </>
            )}
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="danger"
            size="md"
            label="Delete permanently"
            disabled={!ready}
            loading={busy}
            onClick={() => void remove()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
});

/**
 * Reset password (Admin / HR): email the person the usual reset link, or copy it to share another way when email
 * doesn't help. Either way the link works once, for an hour, and they choose their own password; nobody else sees it.
 */
export const ResetPasswordDialog = observer(function ResetPasswordDialog(props: {
  workspaceSlug: string;
  memberId: string | null;
  name: string;
  onClose: () => void;
}) {
  const { workspaceSlug, memberId, name, onClose } = props;
  const { config } = useInstance();
  const emailReady = !!config?.is_smtp_configured;
  const [busy, setBusy] = useState<"email" | "link" | null>(null);
  const [link, setLink] = useState<string | null>(null);

  // a fresh start each time it opens
  useEffect(() => {
    setLink(null);
    setBusy(null);
  }, [memberId]);

  const start = async (send: "email" | "link") => {
    if (!memberId) return;
    setBusy(send);
    try {
      const result = await accessControlService.startPasswordReset(workspaceSlug, memberId, send);
      if (send === "email") {
        setToast({ type: "success", title: "Reset link sent", message: result.message ?? "" });
        onClose();
      } else {
        setLink(result.link ?? null);
      }
    } catch (err) {
      toastError("Couldn't start the reset", err);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await copyTextToClipboard(link);
      setToast({ type: "success", title: "Link copied", message: `Share it only with ${name}.` });
    } catch {
      setToast({ type: "error", title: "Couldn't copy", message: "Select the link and copy it." });
    }
  };

  return (
    <Dialog open={memberId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>{`Reset ${name}'s password`}</DialogTitle>
          <p className="mt-1 text-caption-md-regular text-tertiary">
            They get a link to choose a new password themselves. It works once, for 1 hour, and signs them out
            everywhere else. Nobody else sees the new password.
          </p>
        </div>
        <DialogMain>
          <div className="flex flex-col gap-4 px-5 py-4 text-body-xs-regular text-secondary">
            {link ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="member-reset-link" className="text-caption-md-medium text-primary">
                  {`Reset link for ${name}`}
                </label>
                <InputGroup size="md">
                  <Input
                    id="member-reset-link"
                    size="md"
                    value={link}
                    readOnly
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </InputGroup>
                <p className="text-caption-md-regular text-tertiary">
                  Send it only to them (chat, or in person). Anyone with the link can set the password until it&apos;s
                  used or an hour passes.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <MailOutline className="mt-0.5 size-4 shrink-0 text-tertiary" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-body-sm-medium text-primary">Email them a reset link</span>
                    <span>
                      {emailReady
                        ? "The usual reset email goes to their work address."
                        : "Email isn't set up here, so copy the link instead."}
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CopyOutline className="mt-0.5 size-4 shrink-0 text-tertiary" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-body-sm-medium text-primary">Copy a reset link</span>
                    <span>For when email doesn&apos;t help: share it with them another way.</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogMain>
        <DialogActions>
          {link ? (
            <>
              <Button stretch="auto" variant="secondary" size="md" label="Done" onClick={onClose} />
              <Button stretch="auto" variant="primary" size="md" label="Copy link" onClick={() => void copy()} />
            </>
          ) : (
            <>
              <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={onClose} />
              <Button
                stretch="auto"
                variant="secondary"
                size="md"
                label="Copy a reset link"
                loading={busy === "link"}
                disabled={busy !== null}
                onClick={() => void start("link")}
              />
              <Button
                stretch="auto"
                variant="primary"
                size="md"
                label="Email reset link"
                loading={busy === "email"}
                disabled={busy !== null || !emailReady}
                onClick={() => void start("email")}
              />
            </>
          )}
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
});
