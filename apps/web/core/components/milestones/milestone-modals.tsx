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
import { CalendarOutline } from "@makeplane/propel/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { setToast } from "@plane/blocks/toast";
// components
import { TicketRichTextField as RichTextField } from "@/components/tickets/rich-text-field";
// hooks
import { useUserProfile } from "@/hooks/store/user";
// local imports
import { milestoneService, parseTargetDate, toTargetDate } from "./helpers";
import type { TMilestone } from "./types";

type TModalProps = {
  open: boolean;
  workspaceSlug: string;
  projectId: string;
  /** edit mode when set */
  milestone?: TMilestone | null;
  onClose: (saved: TMilestone | null) => void;
};

export function MilestoneFormModal(props: TModalProps) {
  const { open, workspaceSlug, projectId, milestone, onClose } = props;
  const isEdit = !!milestone;
  const { data: userProfile } = useUserProfile();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("<p></p>");
  const [targetDate, setTargetDate] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // remounts the editor with the right content each time the modal opens
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    setTitle(milestone?.title ?? "");
    setDescription(milestone?.description_html ?? "<p></p>");
    setTargetDate(parseTargetDate(milestone?.target_date));
    setErrors({});
    setEditorKey((key) => key + 1);
  }, [open, milestone]);

  const save = async () => {
    if (saving) return;
    if (!title.trim()) {
      setErrors({ title: "Title is required." });
      return;
    }
    setSaving(true);
    try {
      const payload = { title: title.trim(), description_html: description, target_date: toTargetDate(targetDate) };
      const saved = milestone
        ? await milestoneService.update(workspaceSlug, projectId, milestone.id, payload)
        : await milestoneService.create(workspaceSlug, projectId, payload);
      setToast({ type: "success", title: isEdit ? "Milestone updated" : "Milestone created", message: saved.title });
      onClose(saved);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      setErrors(data);
      setToast({
        type: "error",
        title: isEdit ? "Milestone not updated" : "Milestone not created",
        message: data.title || data.error || "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(null)}>
      <DialogContent size="lg">
        <div className="px-5 pt-5">
          <DialogTitle>{isEdit ? "Edit milestone" : "Add milestone"}</DialogTitle>
        </div>
        <DialogMain>
          <form
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field name="title" invalid={!!errors.title}>
              <div className="flex flex-col gap-1.5">
                <FieldLabel size="md" inset={false} required>
                  Title
                </FieldLabel>
                <InputGroup size="lg">
                  <Input
                    size="lg"
                    maxLength={255}
                    placeholder="e.g. Beta release"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setErrors((prev) => ({ ...prev, title: "" }));
                    }}
                  />
                </InputGroup>
                {errors.title && <span className="text-caption-md-regular text-danger-primary">{errors.title}</span>}
              </div>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm-medium text-primary">Description</span>
              <RichTextField
                key={editorKey}
                id={`milestone-description-${milestone?.id ?? "new"}-${editorKey}`}
                workspaceSlug={workspaceSlug}
                value={description}
                editable
                placeholder="What does this milestone cover?"
                onChange={setDescription}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm-medium text-primary">Target date</span>
              <div className="w-fit rounded-md border-[0.5px] border-subtle">
                <DateSelect
                  variant="select-lg"
                  value={targetDate}
                  onChange={setTargetDate}
                  placeholder="No target date"
                  icon={<CalendarOutline />}
                  clearable
                  weekStartsOn={userProfile?.start_of_the_week}
                />
              </div>
              {errors.target_date && (
                <span className="text-caption-md-regular text-danger-primary">{errors.target_date}</span>
              )}
            </div>
            <button type="submit" className="hidden" tabIndex={-1} />
          </form>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={() => onClose(null)} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label={isEdit ? "Save changes" : "Create"}
            loading={saving}
            onClick={() => void save()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteMilestoneModal(props: {
  open: boolean;
  workspaceSlug: string;
  projectId: string;
  milestone: TMilestone | null;
  onClose: (deleted: boolean) => void;
}) {
  const { open, workspaceSlug, projectId, milestone, onClose } = props;
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!milestone || deleting) return;
    setDeleting(true);
    try {
      await milestoneService.remove(workspaceSlug, projectId, milestone.id);
      setToast({ type: "success", title: "Milestone deleted", message: milestone.title });
      onClose(true);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      setToast({ type: "error", title: "Milestone not deleted", message: data.error ?? "Please try again." });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="sm">
        <div className="px-5 pt-5">
          <DialogTitle>Delete milestone</DialogTitle>
        </div>
        <DialogMain>
          <p className="px-5 py-4 text-body-sm-regular text-secondary">
            Delete <span className="font-medium text-primary">{milestone?.title}</span>? Its work items are unlinked,
            not deleted. This can&apos;t be undone.
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
