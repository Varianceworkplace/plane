/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Field, FieldLabel } from "@makeplane/propel/components/field";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { setToast } from "@plane/blocks/toast";
// local imports
import { worklogService } from "./helpers";
import type { TWorklog } from "./types";

type Props = {
  open: boolean;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  /** edit mode when set */
  worklog?: TWorklog | null;
  onClose: (saved: boolean) => void;
};

const toNumber = (value: string) => (value.trim() === "" ? 0 : Number(value));

export function LogWorkModal(props: Props) {
  const { open, workspaceSlug, projectId, issueId, worklog, onClose } = props;
  const isEdit = !!worklog;
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHours(worklog ? String(Math.floor(worklog.duration / 60) || "") : "");
    setMinutes(worklog ? String(worklog.duration % 60 || "") : "");
    setDescription(worklog?.description ?? "");
    setError("");
  }, [open, worklog]);

  const validate = (): number | null => {
    const h = toNumber(hours);
    const m = toNumber(minutes);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0) {
      setError("Enter whole numbers for hours and minutes.");
      return null;
    }
    if (m > 59) {
      setError("Minutes must be between 0 and 59.");
      return null;
    }
    if (h > 999) {
      setError("Hours can't be more than 999.");
      return null;
    }
    const total = h * 60 + m;
    if (total < 1) {
      setError("Enter the time you spent.");
      return null;
    }
    return total;
  };

  const save = async () => {
    const duration = validate();
    if (duration === null || saving) return;
    setSaving(true);
    try {
      const payload = { duration, description: description.trim() };
      if (worklog) await worklogService.update(workspaceSlug, projectId, issueId, worklog.id, payload);
      else await worklogService.create(workspaceSlug, projectId, issueId, payload);
      setToast({ type: "success", title: isEdit ? "Worklog updated" : "Time logged", message: "" });
      onClose(true);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      const message = data.duration || data.description || data.error || "Something went wrong. Please try again.";
      setError(message);
      setToast({ type: "error", title: isEdit ? "Worklog not updated" : "Time not logged", message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="sm">
        <div className="px-5 pt-5">
          <DialogTitle>{isEdit ? "Edit worklog" : "Log work"}</DialogTitle>
        </div>
        <DialogMain>
          <form
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-3">
                <Field name="hours" invalid={!!error}>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel size="md" inset={false}>
                      Hours
                    </FieldLabel>
                    <InputGroup size="md">
                      <Input
                        size="md"
                        inputMode="numeric"
                        placeholder="0"
                        value={hours}
                        onChange={(e) => {
                          setHours(e.target.value.replace(/[^\d]/g, ""));
                          setError("");
                        }}
                      />
                    </InputGroup>
                  </div>
                </Field>
                <Field name="minutes" invalid={!!error}>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel size="md" inset={false}>
                      Minutes
                    </FieldLabel>
                    <InputGroup size="md">
                      <Input
                        size="md"
                        inputMode="numeric"
                        placeholder="0"
                        value={minutes}
                        onChange={(e) => {
                          setMinutes(e.target.value.replace(/[^\d]/g, ""));
                          setError("");
                        }}
                      />
                    </InputGroup>
                  </div>
                </Field>
              </div>
              {error && <span className="text-caption-md-regular text-danger-primary">{error}</span>}
            </div>
            <Field name="description">
              <div className="flex flex-col gap-1.5">
                <FieldLabel size="md" inset={false}>
                  Description
                </FieldLabel>
                <TextAreaGroup resize="none">
                  <TextArea
                    size="lg"
                    surface="field"
                    autoResize
                    maxRows={8}
                    aria-label="Description"
                    placeholder="What did you work on?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </TextAreaGroup>
              </div>
            </Field>
            <button type="submit" className="hidden" tabIndex={-1} />
          </form>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label={isEdit ? "Save changes" : "Log work"}
            loading={saving}
            onClick={() => void save()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteWorklogModal(props: {
  open: boolean;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  worklog: TWorklog | null;
  onClose: (deleted: boolean) => void;
}) {
  const { open, workspaceSlug, projectId, issueId, worklog, onClose } = props;
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!worklog || deleting) return;
    setDeleting(true);
    try {
      await worklogService.remove(workspaceSlug, projectId, issueId, worklog.id);
      setToast({ type: "success", title: "Worklog deleted", message: "" });
      onClose(true);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      setToast({ type: "error", title: "Worklog not deleted", message: data.error ?? "" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="sm">
        <div className="px-5 pt-5">
          <DialogTitle>Delete worklog</DialogTitle>
        </div>
        <DialogMain>
          <p className="px-5 py-4 text-body-sm-regular text-secondary">
            Are you sure you want to delete this worklog? The logged time will be removed from all reports. This
            can&apos;t be undone.
          </p>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(false)} />
          <Button
            stretch="auto"
            variant="danger"
            size="md"
            label="Delete"
            loading={deleting}
            onClick={() => void remove()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
