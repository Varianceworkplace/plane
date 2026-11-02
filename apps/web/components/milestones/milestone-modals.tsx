/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { CalendarOutline } from "@makeplane/propel/icons";
import { Logo } from "@plane/blocks/emoji-icon-picker";
import type { ProjectOption } from "@plane/blocks/property-select";
import { DateSelect, ProjectSelect } from "@plane/blocks/property-select";
import { EUserPermissions } from "@plane/constants";
import { setToast } from "@plane/blocks/toast";
import { cn } from "@plane/utils";
// components
import { MemberSelect } from "@/components/dropdowns/member/member-select";
import { PicklistSelect } from "@/components/task-details/field-input";
import { TicketRichTextField as RichTextField } from "@/components/tickets/rich-text-field";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserProfile } from "@/hooks/store/user";
// local imports
import { milestoneService, parseTargetDate, toTargetDate, useMilestoneOptions } from "./helpers";
import type { TMilestone, TMilestonePayload } from "./types";

type TModalProps = {
  open: boolean;
  workspaceSlug: string;
  /** the project of the milestone; "" lets a new milestone pick it ("Related to") */
  projectId: string;
  /** edit mode when set */
  milestone?: TMilestone | null;
  onClose: (saved: TMilestone | null) => void;
};

type TFieldKey =
  | "title"
  | "related_to"
  | "start_date"
  | "target_date"
  | "milestone_type"
  | "status"
  | "actual_completion_date"
  | "assigned_to_id";

/** Labels as on the Workplace "Creating New Project Milestone" form. */
const LABELS: Record<TFieldKey, string> = {
  title: "Phase / Release / Milestone name",
  related_to: "Related to",
  start_date: "Start date",
  target_date: "End date",
  milestone_type: "Type",
  status: "Milestone status",
  actual_completion_date: "Actual completion date",
  assigned_to_id: "Assigned to",
};

type TFormValues = {
  title: string;
  start_date: Date | null;
  target_date: Date | null;
  actual_completion_date: Date | null;
  milestone_type: string;
  status: string;
  assigned_to_id: string | null;
};

type TDateKey = "start_date" | "target_date" | "actual_completion_date";

function FormField(props: {
  name: TFieldKey;
  required?: boolean;
  error?: string;
  bordered?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const { name, required = false, error, bordered = false, wide = false, children } = props;
  return (
    <div className={cn("flex flex-col gap-1.5", wide && "sm:col-span-2")}>
      <span className="text-body-xs-medium text-secondary">
        {LABELS[name]}
        {required && <span className="text-danger-primary"> *</span>}
      </span>
      {bordered ? (
        <div className={cn("rounded-md border-[0.5px]", error ? "border-danger-strong" : "border-subtle")}>
          {children}
        </div>
      ) : (
        children
      )}
      {error && (
        <span data-milestone-error className="text-caption-md-regular text-danger-primary">
          {error}
        </span>
      )}
    </div>
  );
}

/** What Save can't accept: the two required fields and end dates before the start. */
const validate = (values: TFormValues, projectId: string) => {
  const errors: Partial<Record<TFieldKey, string>> = {};
  if (!values.title.trim()) errors.title = `${LABELS.title} is required`;
  if (!projectId) errors.related_to = `${LABELS.related_to} is required`;
  if (!values.assigned_to_id) errors.assigned_to_id = `${LABELS.assigned_to_id} is required`;
  const start = toTargetDate(values.start_date);
  const end = toTargetDate(values.target_date);
  const actual = toTargetDate(values.actual_completion_date);
  if (start && end && end < start) errors.target_date = "Can't be before the start date";
  if (start && actual && actual < start) errors.actual_completion_date = "Can't be before the start date";
  return errors;
};

const showErrors = (errors: Partial<Record<string, string>>) => {
  const keys = Object.keys(errors).filter((key) => errors[key]);
  if (!keys.length) return;
  const label = (key: string) => LABELS[key as TFieldKey] ?? key;
  const missing = keys.filter((key) => /required/i.test(errors[key] ?? ""));
  setToast({
    type: "error",
    title: missing.length
      ? missing.length === 1
        ? "1 required field is empty"
        : `${missing.length} required fields are empty`
      : "Some fields need a fix",
    message: `${missing.length ? "Please fill in" : "Check"}: ${(missing.length ? missing : keys).map(label).join(", ")}.`,
  });
  // bring the first one into view once the red outlines have rendered
  window.requestAnimationFrame(() =>
    document.querySelector("[data-milestone-error]")?.scrollIntoView({ behavior: "smooth", block: "center" })
  );
};

/** Create / edit a milestone with every field of the Workplace "Project Milestone" form. */
export const MilestoneFormModal = observer(function MilestoneFormModal(props: TModalProps) {
  const { open, workspaceSlug, projectId, milestone, onClose } = props;
  const isEdit = !!milestone;
  const { data: userProfile } = useUserProfile();
  const { data: currentUser } = useUser();
  const { workspaceProjectIds, getProjectById } = useProject();
  // set when the modal opens; only a new milestone opened outside a project picks one
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const canPickProject = !isEdit && !projectId;
  const project = getProjectById(selectedProjectId);
  const options = useMilestoneOptions(workspaceSlug);
  // projects with milestones on, where the user can add them (admins and members)
  const projectOptions = useMemo<ProjectOption[]>(
    () =>
      (workspaceProjectIds ?? [])
        .map((id) => getProjectById(id))
        .filter(
          (item): item is NonNullable<typeof item> =>
            !!item &&
            !item.archived_at &&
            !!item.is_milestone_enabled &&
            (item.member_role === EUserPermissions.ADMIN || item.member_role === EUserPermissions.MEMBER)
        )
        .map((item) => ({ id: item.id, name: item.name, identifier: item.identifier, logo_props: item.logo_props })),
    [workspaceProjectIds, getProjectById]
  );
  const getProjects = useCallback(
    async ({ search }: { search?: string }) => {
      const query = search?.trim().toLowerCase();
      const results = projectOptions.filter(
        (item) => !query || `${item.name} ${item.identifier ?? ""}`.toLowerCase().includes(query)
      );
      return { results, next_page_results: false };
    },
    [projectOptions]
  );
  const [values, setValues] = useState<TFormValues>({
    title: "",
    start_date: null,
    target_date: null,
    actual_completion_date: null,
    milestone_type: "",
    status: "",
    assigned_to_id: null,
  });
  const [description, setDescription] = useState("<p></p>");
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  // remounts the editor with the right content each time the modal opens
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    setValues({
      title: milestone?.title ?? "",
      start_date: parseTargetDate(milestone?.start_date),
      target_date: parseTargetDate(milestone?.target_date),
      actual_completion_date: parseTargetDate(milestone?.actual_completion_date),
      milestone_type: milestone?.milestone_type ?? "",
      status: milestone?.status ?? "",
      // like Workplace, a new milestone starts out assigned to whoever creates it
      assigned_to_id: milestone ? milestone.assigned_to_id : (currentUser?.id ?? null),
    });
    setDescription(milestone?.description_html ?? "<p></p>");
    setSelectedProjectId(projectId);
    setErrors({});
    setEditorKey((key) => key + 1);
  }, [open, milestone, currentUser?.id, projectId]);

  const change = <K extends keyof TFormValues>(key: K, value: TFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
  };

  const save = async () => {
    if (saving) return;
    const found = validate(values, selectedProjectId);
    setErrors(found);
    if (Object.keys(found).length) {
      showErrors(found);
      return;
    }
    setSaving(true);
    try {
      const payload: TMilestonePayload = {
        title: values.title.trim(),
        description_html: description,
        start_date: toTargetDate(values.start_date),
        target_date: toTargetDate(values.target_date),
        actual_completion_date: toTargetDate(values.actual_completion_date),
        milestone_type: values.milestone_type,
        status: values.status,
        assigned_to_id: values.assigned_to_id,
      };
      const saved = milestone
        ? await milestoneService.update(workspaceSlug, selectedProjectId, milestone.id, payload)
        : await milestoneService.create(workspaceSlug, selectedProjectId, payload);
      setToast({ type: "success", title: isEdit ? "Milestone updated" : "Milestone created", message: saved.title });
      onClose(saved);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      if (data.error) {
        setToast({
          type: "error",
          title: isEdit ? "Milestone not updated" : "Milestone not created",
          message: data.error,
        });
      } else {
        // the server's own check (field -> message)
        setErrors(data);
        showErrors(data);
      }
    } finally {
      setSaving(false);
    }
  };

  const dateField = (key: TDateKey, limit: { minDate?: Date; maxDate?: Date }) => (
    <FormField name={key} error={errors[key]} bordered>
      <DateSelect
        variant="select-md"
        className="w-full"
        value={values[key]}
        onChange={(date) => change(key, date)}
        {...limit}
        placeholder={`Select ${LABELS[key].toLowerCase()}`}
        icon={<CalendarOutline />}
        clearable
        weekStartsOn={userProfile?.start_of_the_week}
      />
    </FormField>
  );

  const picklistField = (key: "milestone_type" | "status") => (
    <FormField name={key} error={errors[key]}>
      <PicklistSelect
        options={(options?.[key] ?? []).map((option) => ({ id: option, label: option }))}
        value={values[key]}
        onChange={(id) => change(key, id)}
        placeholder={`Select ${LABELS[key].toLowerCase()}`}
        mode="form"
        invalid={!!errors[key]}
      />
    </FormField>
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(null)}>
      <DialogContent size="xl">
        <div className="px-5 pt-5">
          <DialogTitle>{isEdit ? "Edit milestone" : "Add milestone"}</DialogTitle>
          <p className="mt-1 text-caption-md-regular text-placeholder">
            Fields marked <span className="text-danger-primary">*</span> are required
          </p>
        </div>
        <DialogMain>
          <form
            className="grid grid-cols-1 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <FormField name="title" required error={errors.title}>
              <InputGroup size="md">
                <Input
                  size="md"
                  maxLength={255}
                  aria-label={LABELS.title}
                  aria-invalid={!!errors.title || undefined}
                  placeholder="e.g. Phase 1 release"
                  value={values.title}
                  onChange={(e) => change("title", e.target.value)}
                />
              </InputGroup>
            </FormField>
            {/* milestones live in a project: "Related to" is that project */}
            {canPickProject ? (
              <FormField name="related_to" required error={errors.related_to} bordered>
                <ProjectSelect
                  variant="select-md"
                  className="w-full"
                  getValues={getProjects}
                  value={projectOptions.find((item) => item.id === selectedProjectId) ?? null}
                  onChange={(id) => {
                    setSelectedProjectId(id);
                    setErrors((previous) => ({ ...previous, related_to: "" }));
                  }}
                  placeholder="Select a project"
                  searchPlaceholder="Search projects"
                />
              </FormField>
            ) : (
              <FormField name="related_to" required>
                <div className="flex h-8 items-center gap-2 rounded-md border-[0.5px] border-subtle bg-layer-1 px-2 text-body-xs-regular text-primary">
                  {project?.logo_props && <Logo logo={project.logo_props} size={14} />}
                  <span className="truncate">{project?.name ?? "This project"}</span>
                </div>
              </FormField>
            )}
            {dateField("start_date", { maxDate: values.target_date ?? undefined })}
            {dateField("target_date", { minDate: values.start_date ?? undefined })}
            {picklistField("milestone_type")}
            {picklistField("status")}
            {dateField("actual_completion_date", { minDate: values.start_date ?? undefined })}
            <FormField name="assigned_to_id" required error={errors.assigned_to_id} bordered>
              <MemberSelect
                projectId={selectedProjectId || undefined}
                value={values.assigned_to_id}
                onChange={(id) => change("assigned_to_id", id || null)}
                placeholder="Select a person"
                variant="select-md"
                className="w-full"
              />
            </FormField>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-body-xs-medium text-secondary">Description</span>
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
});

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
            Delete <span className="font-medium text-primary">{milestone?.title}</span>? Its project tasks are unlinked,
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
