/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { Controller, useFormContext } from "react-hook-form";
// plane imports
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { CalendarOutline, PropertiesOutline } from "@makeplane/propel/icons";
import { PriorityIcon } from "@plane/blocks/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { Select } from "@plane/blocks/select";
import { ISSUE_PRIORITIES } from "@plane/constants";
import type { TIssue } from "@plane/types";
import { cn, getDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { MemberSelect } from "@/components/dropdowns/member/member-select";
import { useProjectMilestones, useWorkItemMilestone } from "@/components/milestones/helpers";
import { useIssueTimeEstimate } from "@/components/worklogs/helpers";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useProject } from "@/hooks/store/use-project";
import { useUserProfile } from "@/hooks/store/user";
// local imports
import { PicklistSelect, TaskDetailFieldInput } from "./field-input";
import { readTaskDetailsForm } from "./form-values";
import type { TTaskDetailsFormErrors, TTaskDetailsFormValues } from "./form-values";
import { TASK_DETAIL_FIELDS, useTaskDetail, useTaskDetailOptions } from "./helpers";

type TPriorityOption = (typeof ISSUE_PRIORITIES)[number];
// Workplace has no "None" priority: the field is required
const PRIORITY_OPTIONS = ISSUE_PRIORITIES.filter((priority) => priority.key !== "none");

type Props = {
  workspaceSlug: string;
  projectId: string | null;
  /** set when editing an existing work item */
  issueId?: string;
};

/** Message under a field the Save check flagged; also the anchor the form scrolls to. */
function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <span data-task-detail-error className="text-caption-md-regular text-danger-primary">
      {message}
    </span>
  );
}

function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <span className="text-body-xs-medium text-secondary">
      {text}
      {required && <span className="text-danger-primary"> *</span>}
    </span>
  );
}

/** "Project task details" part of the create / edit work item form, for projects with task details on. */
export const TaskDetailsFormSection = observer(function TaskDetailsFormSection(props: Props) {
  const { workspaceSlug, projectId, issueId } = props;
  const { getProjectById } = useProject();
  const project = projectId ? getProjectById(projectId) : undefined;
  const enabled = !!project?.is_task_details_enabled;
  const withExpectedTime = !!project?.is_time_tracking_enabled;
  const withMilestone = !!project?.is_milestone_enabled;
  const { issuePropertyValues, setIssuePropertyValues, issuePropertyValueErrors, setIssuePropertyValueErrors } =
    useIssueModal();
  const values = readTaskDetailsForm(issuePropertyValues);
  const errors = issuePropertyValueErrors as TTaskDetailsFormErrors;
  const options = useTaskDetailOptions(workspaceSlug, enabled);
  // start / end date are the work item's own dates (the same values as the pills under the form)
  const { control, watch, setValue, getValues } = useFormContext<TIssue>();
  const { data: userProfile } = useUserProfile();
  const startDate = getDate(watch("start_date")) ?? null;
  const targetDate = getDate(watch("target_date")) ?? null;

  // editing: start from what the work item already has
  const loadExisting = enabled && !!issueId && values.loaded_for !== issueId;
  const { taskDetail } = useTaskDetail(workspaceSlug, projectId ?? "", issueId ?? "", loadExisting);
  const { estimate } = useIssueTimeEstimate(
    workspaceSlug,
    projectId ?? "",
    issueId ?? "",
    loadExisting && withExpectedTime
  );
  const { milestone: existingMilestone, isLoading: milestoneLoading } = useWorkItemMilestone(
    workspaceSlug,
    projectId ?? "",
    issueId ?? "",
    loadExisting && withMilestone
  );
  const { milestones } = useProjectMilestones(workspaceSlug, projectId ?? "", enabled && withMilestone);

  // a new task starts at Normal (Medium) priority, as on the Workplace form
  useEffect(() => {
    if (!enabled || issueId) return;
    const priority = getValues("priority");
    if (!priority || priority === "none") setValue("priority", "medium");
  }, [enabled, issueId, getValues, setValue]);

  useEffect(() => {
    if (!loadExisting || !taskDetail || (withExpectedTime && !estimate) || (withMilestone && milestoneLoading)) return;
    const expected = estimate?.expected_duration ?? null;
    setIssuePropertyValues({
      detail: taskDetail,
      expected_hours: expected ? String(Math.floor(expected / 60) || "") : "",
      expected_minutes: expected ? String(expected % 60 || "") : "",
      overdue_reason: estimate?.overdue_reason ?? "",
      milestone_id: withMilestone ? (existingMilestone?.id ?? null) : undefined,
      loaded_for: issueId,
    } satisfies TTaskDetailsFormValues);
  }, [
    loadExisting,
    taskDetail,
    estimate,
    withExpectedTime,
    withMilestone,
    milestoneLoading,
    existingMilestone,
    issueId,
    setIssuePropertyValues,
  ]);

  if (!enabled) return null;

  const update = (patch: Partial<TTaskDetailsFormValues>) =>
    setIssuePropertyValues((previous) => ({ ...readTaskDetailsForm(previous), ...patch }));
  // a field's red outline goes away as soon as it's filled in
  const clearError = (key: keyof TTaskDetailsFormErrors) =>
    setIssuePropertyValueErrors((previous) => {
      if (!(key in previous)) return previous;
      const { [key]: _cleared, ...rest } = previous;
      return rest;
    });

  return (
    <section className="mt-4 flex flex-col gap-3 border-t border-subtle pt-4">
      <div className="flex items-center gap-1.5">
        <PropertiesOutline className="size-4 text-tertiary" />
        <h4 className="text-body-sm-medium text-primary">Project task details</h4>
        <span className="text-caption-md-regular text-placeholder">
          · fields marked <span className="text-danger-primary">*</span> are required
        </span>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label text="Assigned to" required />
          <div
            className={cn("rounded-md border-[0.5px]", errors.assignee_ids ? "border-danger-strong" : "border-subtle")}
          >
            {/* the work item's assignee or group: the same value as the "Assigned to" pill under the form */}
            <Controller
              control={control}
              name="assignee_ids"
              render={({ field: { value, onChange } }) => (
                <MemberSelect
                  projectId={projectId ?? undefined}
                  value={value?.[0] ?? null}
                  onChange={(assigneeId) => {
                    onChange(assigneeId ? [assigneeId] : []);
                    if (getValues("assignee_group_id")) setValue("assignee_group_id", null);
                    if (assigneeId) clearError("assignee_ids");
                  }}
                  assigneeGroup={{
                    value: watch("assignee_group_id"),
                    onChange: (groupId) => {
                      setValue("assignee_group_id", groupId);
                      if (!groupId) return;
                      onChange([]);
                      clearError("assignee_ids");
                    },
                  }}
                  placeholder="Select a person or group"
                  clearable
                  clearLabel="No assignee"
                  variant="select-md"
                  className="w-full"
                />
              )}
            />
          </div>
          <FieldError message={errors.assignee_ids} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label text="Priority" required />
          <div className={cn("rounded-md border-[0.5px]", errors.priority ? "border-danger-strong" : "border-subtle")}>
            {/* the work item's priority: the same value as the priority pill under the form */}
            <Controller
              control={control}
              name="priority"
              render={({ field: { value, onChange } }) => {
                const selected = PRIORITY_OPTIONS.find((option) => option.key === value) ?? null;
                return (
                  <Select<TPriorityOption>
                    getValues={() => PRIORITY_OPTIONS}
                    value={selected}
                    onChange={(key) => {
                      onChange(key);
                      clearError("priority");
                    }}
                    getOptionValue={(option) => option.key}
                    getOptionLabel={(option) => option.title}
                    getOptionIcon={(option) => <PriorityIcon priority={option.key} className="size-3.5" />}
                    showSearch={false}
                    pinSelected={false}
                  >
                    <Select.Trigger<TPriorityOption> variant="select-md" className="w-full">
                      <span className="flex min-w-0 items-center gap-1.5 truncate text-left">
                        {selected ? (
                          <>
                            <PriorityIcon priority={selected.key} className="size-3.5" />
                            {selected.title}
                          </>
                        ) : (
                          <span className="text-placeholder">Select priority</span>
                        )}
                      </span>
                    </Select.Trigger>
                  </Select>
                );
              }}
            />
          </div>
          <FieldError message={errors.priority} />
        </div>
        {withMilestone && (
          <div className="flex flex-col gap-1.5">
            <Label text="Project milestone name" />
            <PicklistSelect
              options={(milestones ?? []).map((milestone) => ({ id: milestone.id, label: milestone.title }))}
              value={values.milestone_id ?? ""}
              onChange={(id) => update({ milestone_id: id || null })}
              placeholder="Select a milestone"
              mode="form"
            />
          </div>
        )}
        {TASK_DETAIL_FIELDS.map((field) => (
          <div
            key={field.key}
            className={field.kind === "textarea" ? "flex flex-col gap-1.5 sm:col-span-2" : "flex flex-col gap-1.5"}
          >
            <Label text={field.label} required={field.required} />
            <TaskDetailFieldInput
              field={field}
              value={values.detail[field.key]}
              options={options}
              onChange={(value) => {
                update({ detail: { ...values.detail, [field.key]: value } });
                clearError(field.key);
              }}
              mode="form"
              invalid={!!errors[field.key]}
            />
            <FieldError message={errors[field.key]} />
          </div>
        ))}
        {(
          [
            { name: "start_date", label: "Start date", limit: { maxDate: targetDate ?? undefined } },
            { name: "target_date", label: "End date", limit: { minDate: startDate ?? undefined } },
          ] as const
        ).map(({ name, label, limit }) => (
          <div key={name} className="flex flex-col gap-1.5">
            <Label text={label} required />
            <div className={cn("rounded-md border-[0.5px]", errors[name] ? "border-danger-strong" : "border-subtle")}>
              <Controller
                control={control}
                name={name}
                render={({ field: { value, onChange } }) => (
                  <DateSelect
                    value={getDate(value) ?? null}
                    onChange={(date) => {
                      onChange(date ? renderFormattedPayloadDate(date) : null);
                      if (date) clearError(name);
                    }}
                    {...limit}
                    placeholder={`Select ${label.toLowerCase()}`}
                    icon={<CalendarOutline />}
                    weekStartsOn={userProfile?.start_of_the_week}
                    clearable
                    variant="select-md"
                    className="w-full"
                  />
                )}
              />
            </div>
            <FieldError message={errors[name]} />
          </div>
        ))}
        {withExpectedTime && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label text="Expected time" required />
              <div className="grid grid-cols-2 gap-2">
                <InputGroup size="md">
                  <Input
                    size="md"
                    inputMode="numeric"
                    placeholder="Hours"
                    aria-label="Expected hours"
                    aria-invalid={!!errors.expected_time || undefined}
                    value={values.expected_hours}
                    onChange={(e) => {
                      update({ expected_hours: e.target.value.replace(/[^\d]/g, "") });
                      clearError("expected_time");
                    }}
                  />
                </InputGroup>
                <InputGroup size="md">
                  <Input
                    size="md"
                    inputMode="numeric"
                    placeholder="Minutes"
                    aria-label="Expected minutes"
                    aria-invalid={!!errors.expected_time || undefined}
                    value={values.expected_minutes}
                    onChange={(e) => {
                      update({ expected_minutes: e.target.value.replace(/[^\d]/g, "") });
                      clearError("expected_time");
                    }}
                  />
                </InputGroup>
              </div>
              <FieldError message={errors.expected_time} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label text="Task overdue comments" />
              <TextAreaGroup resize="none">
                <TextArea
                  size="md"
                  surface="field"
                  autoResize
                  maxRows={4}
                  aria-label="Task overdue comments"
                  placeholder="Why the task is taking longer than expected"
                  value={values.overdue_reason}
                  onChange={(e) => update({ overdue_reason: e.target.value })}
                />
              </TextAreaGroup>
            </div>
          </>
        )}
      </div>
    </section>
  );
});
