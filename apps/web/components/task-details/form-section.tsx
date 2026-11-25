/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Controller, useFormContext } from "react-hook-form";
// plane imports
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { CalendarOutline, CloseOutline, ParentOutline, PropertiesOutline } from "@makeplane/propel/icons";
import { PriorityIcon } from "@plane/blocks/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { Select } from "@plane/blocks/select";
import { ISSUE_PRIORITIES } from "@plane/constants";
import type { TIssue } from "@plane/types";
import { cn, getDate, renderFormattedDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { MemberSelect } from "@/components/dropdowns/member/member-select";
import { ProjectSelect } from "@/components/dropdowns/project/project-select";
import { StateSelect } from "@/components/dropdowns/state/state-select";
import { ParentIssuesListModal } from "@/components/issues/parent-issues-list-modal";
import { useProjectMilestones, useWorkItemMilestone } from "@/components/milestones/helpers";
import { useIssueTimeEstimate } from "@/components/worklogs/helpers";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUserProfile } from "@/hooks/store/user";
// local imports
import { PicklistSelect, TaskDetailFieldInput } from "./field-input";
import { readTaskDetailsForm } from "./form-values";
import type { TTaskDetailsFormErrors, TTaskDetailsFormValues } from "./form-values";
import { TASK_DETAIL_FIELDS, useTaskDetail, useTaskDetailOptions } from "./helpers";
import type { TTaskDetail, TTaskDetailField } from "./types";

type TPriorityOption = (typeof ISSUE_PRIORITIES)[number];
// Workplace has no "None" priority: the field is required
const PRIORITY_OPTIONS = ISSUE_PRIORITIES.filter((priority) => priority.key !== "none");

const FIELD_BY_KEY = Object.fromEntries(TASK_DETAIL_FIELDS.map((field) => [field.key, field])) as Record<
  keyof TTaskDetail,
  TTaskDetailField
>;

type Props = {
  workspaceSlug: string;
  projectId: string | null;
  /** set when editing an existing work item */
  issueId?: string;
  /** the work item's title input: "Project task name", the first field of the Workplace form */
  titleField: ReactNode;
  /** the description editor: near the end, under "Description details", as on the Workplace form */
  descriptionField: ReactNode;
  /** "Related to" (the project) can't change: editing, a copy, or a form opened for one project */
  isProjectSelectionDisabled?: boolean;
  /** tells the modal the form changed, so unsaved work is kept */
  handleFormChange?: () => void;
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

/** One field: its label, control and message. */
function Cell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={cn("flex flex-col gap-1.5", wide && "sm:col-span-2")}>{children}</div>;
}

/** Keeps the next field in the right-hand column, where the Workplace form has it. */
function EmptyCell() {
  return <div aria-hidden className="hidden sm:block" />;
}

/** A block of the Workplace form ("Project Task Details", "Custom Information", ...): two columns, row by row. */
function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <PropertiesOutline className="size-4 text-tertiary" />
        <h4 className="text-body-sm-medium text-primary">{title}</h4>
        {note}
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/**
 * The create / edit work item form of a project with task details on, laid out as Workplace's "Creating New Project
 * Task" form, row by row: Project task details, Custom information, Code review, Description details. Status, Related
 * to (the project) and the parent task are the same values as the pills of the form.
 */
export const TaskDetailsFormSection = observer(function TaskDetailsFormSection(props: Props) {
  const {
    workspaceSlug,
    projectId,
    issueId,
    titleField,
    descriptionField,
    isProjectSelectionDisabled = false,
    handleFormChange,
  } = props;
  const { getProjectById } = useProject();
  const project = projectId ? getProjectById(projectId) : undefined;
  const enabled = !!project?.is_task_details_enabled;
  const withExpectedTime = !!project?.is_time_tracking_enabled;
  const withMilestone = !!project?.is_milestone_enabled;
  const {
    issuePropertyValues,
    setIssuePropertyValues,
    issuePropertyValueErrors,
    setIssuePropertyValueErrors,
    allowedProjectIds,
    selectedParentIssue,
    setSelectedParentIssue,
  } = useIssueModal();
  const { getProjectDefaultStateId } = useProjectState();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const [parentModalOpen, setParentModalOpen] = useState(false);
  const values = readTaskDetailsForm(issuePropertyValues);
  const errors = issuePropertyValueErrors as TTaskDetailsFormErrors;
  const options = useTaskDetailOptions(workspaceSlug, enabled);
  // start / end date are the work item's own dates (the same values as the pills under the form)
  const { control, watch, setValue, getValues } = useFormContext<TIssue>();
  const { data: userProfile } = useUserProfile();
  const startDate = getDate(watch("start_date")) ?? null;
  const targetDate = getDate(watch("target_date")) ?? null;
  const parentId = watch("parent_id");
  const parent = parentId && selectedParentIssue?.id === parentId ? selectedParentIssue : null;
  // set by the app when the task moves to a completed status, as Workplace fills it in
  const completedAt = issueId ? getIssueById(issueId)?.completed_at : null;

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

  // a new task starts at Normal (Medium) priority, as on the Workplace form. Checked after every render, not once: the
  // modal resets its values right after this mounts (and again for "Create more"), within the same render, so the
  // watched priority reads "none" before and after. A task can't be saved without a priority anyway.
  useEffect(() => {
    if (!enabled || issueId) return;
    const priority = getValues("priority");
    if (!priority || priority === "none") setValue("priority", "medium");
  });

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

  /** A Workplace field kept in task details (Type, Project phase, GIT URL, ...). */
  const detailField = (key: keyof TTaskDetail) => {
    const field = FIELD_BY_KEY[key];
    return (
      <Cell key={key}>
        <Label text={field.label} required={field.required} />
        <TaskDetailFieldInput
          field={field}
          value={values.detail[key]}
          options={options}
          onChange={(value) => {
            update({ detail: { ...values.detail, [key]: value } });
            clearError(key);
          }}
          mode="form"
          invalid={!!errors[key]}
        />
        <FieldError message={errors[key]} />
      </Cell>
    );
  };

  const assigneeField = (
    <Cell>
      <Label text="Assigned to" required />
      <div className={cn("rounded-md border-[0.5px]", errors.assignee_ids ? "border-danger-strong" : "border-subtle")}>
        {/* the work item's assignee or team: the same value as the "Assigned to" pill under the form */}
        <Controller
          control={control}
          name="assignee_ids"
          render={({ field: { value, onChange } }) => (
            <MemberSelect
              projectId={projectId ?? undefined}
              value={value?.[0] ?? null}
              onChange={(assigneeId) => {
                onChange(assigneeId ? [assigneeId] : []);
                if (getValues("assignee_team_id")) setValue("assignee_team_id", null);
                if (assigneeId) clearError("assignee_ids");
              }}
              assigneeTeam={{
                value: watch("assignee_team_id"),
                onChange: (teamId) => {
                  setValue("assignee_team_id", teamId);
                  if (!teamId) return;
                  onChange([]);
                  clearError("assignee_ids");
                },
              }}
              placeholder="Select a person or team"
              clearable
              clearLabel="No assignee"
              variant="select-md"
              className="w-full"
            />
          )}
        />
      </div>
      <FieldError message={errors.assignee_ids} />
    </Cell>
  );

  const priorityField = (
    <Cell>
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
    </Cell>
  );

  const statusField = (
    <Cell>
      <Label text="Status" required />
      <div className="rounded-md border-[0.5px] border-subtle">
        {/* the work item's status: the same value as the status pill under the form */}
        <Controller
          control={control}
          name="state_id"
          render={({ field: { value, onChange } }) => (
            <StateSelect
              // an empty status is the project's default one, as on the pill
              value={value || getProjectDefaultStateId(projectId)}
              onChange={(stateId) => {
                onChange(stateId);
                handleFormChange?.();
              }}
              projectId={projectId ?? undefined}
              variant="select-md"
              className="w-full"
            />
          )}
        />
      </div>
    </Cell>
  );

  const relatedToField = (
    <Cell>
      <Label text="Related to" required />
      <div className="rounded-md border-[0.5px] border-subtle">
        {/* the project: the same value as the project pill at the top of the form */}
        <Controller
          control={control}
          name="project_id"
          render={({ field: { value, onChange } }) => (
            <ProjectSelect
              value={value}
              onChange={(id) => {
                if (!id) return;
                onChange(id);
                handleFormChange?.();
              }}
              multiple={false}
              variant="select-md"
              filterOption={(id) => allowedProjectIds.includes(id)}
              disabled={isProjectSelectionDisabled}
              className="w-full"
            />
          )}
        />
      </div>
    </Cell>
  );

  const milestoneField = (
    <Cell>
      <Label text="Project milestone name" />
      <PicklistSelect
        options={(milestones ?? []).map((milestone) => ({ id: milestone.id, label: milestone.title }))}
        value={values.milestone_id ?? ""}
        onChange={(id) => update({ milestone_id: id || null })}
        placeholder="Select a milestone"
        mode="form"
      />
    </Cell>
  );

  const completionDateField = (
    <Cell>
      <Label text="Project task completion date" />
      <InputGroup size="md">
        <Input
          size="md"
          aria-label="Project task completion date"
          placeholder="Filled in when the task is completed"
          value={completedAt ? (renderFormattedDate(completedAt) ?? "") : ""}
          disabled
          readOnly
        />
      </InputGroup>
    </Cell>
  );

  const parentField = (
    <Cell>
      <Label text="Parent project task" />
      {/* the parent work item: the same value as the parent pill under the form */}
      <div className="flex items-center gap-1 rounded-md border-[0.5px] border-subtle pr-1">
        <button
          type="button"
          onClick={() => setParentModalOpen(true)}
          className="flex h-(--control-height-md) min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-body-xs-regular hover:bg-layer-transparent-hover"
        >
          <ParentOutline className="size-3.5 shrink-0 text-tertiary" />
          {parent ? (
            <span className="truncate">
              <span className="text-tertiary">
                {parent.project__identifier}-{parent.sequence_id}
              </span>{" "}
              {parent.name}
            </span>
          ) : (
            <span className="truncate text-placeholder">
              {parentId ? "Parent task selected" : "Select a parent task"}
            </span>
          )}
        </button>
        {parentId && (
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon={CloseOutline} />}
            aria-label="Remove parent task"
            onClick={() => {
              setValue("parent_id", null, { shouldDirty: true });
              handleFormChange?.();
            }}
          />
        )}
      </div>
      <ParentIssuesListModal
        isOpen={parentModalOpen}
        handleClose={() => setParentModalOpen(false)}
        onChange={(issue) => {
          setValue("parent_id", issue.id, { shouldDirty: true });
          setSelectedParentIssue(issue);
          handleFormChange?.();
        }}
        projectId={projectId ?? undefined}
        issueId={issueId}
      />
    </Cell>
  );

  const dateFields = (
    [
      { name: "start_date", label: "Start date", limit: { maxDate: targetDate ?? undefined } },
      { name: "target_date", label: "End date", limit: { minDate: startDate ?? undefined } },
    ] as const
  ).map(({ name, label, limit }) => (
    <Cell key={name}>
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
    </Cell>
  ));

  const expectedTimeField = (
    <Cell>
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
    </Cell>
  );

  const overdueCommentsField = (
    <Cell>
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
    </Cell>
  );

  // Row by row as on Workplace: left field, then right field
  return (
    <section className="flex flex-col gap-5">
      <Group
        title="Project task details"
        note={
          <span className="text-caption-md-regular text-placeholder">
            · fields marked <span className="text-danger-primary">*</span> are required
          </span>
        }
      >
        <Cell>
          <Label text="Project task name" required />
          {titleField}
        </Cell>
        {detailField("project_phase")}
        {priorityField}
        {detailField("technology")}
        {detailField("task_type")}
        {assigneeField}
        {statusField}
        {detailField("not_in_project_plan")}
        {relatedToField}
        {withMilestone ? milestoneField : <EmptyCell />}
        {detailField("requested_by_id")}
        {detailField("git_url")}
        {completionDateField}
        {detailField("create_code_review")}
        {parentField}
        {detailField("build_version")}
        {detailField("user_manual_url")}
        {detailField("bug_type")}
        {detailField("severity")}
        {detailField("environment")}
      </Group>
      <Group title="Custom information">
        {dateFields}
        {withExpectedTime && (
          <>
            {expectedTimeField}
            {overdueCommentsField}
          </>
        )}
        {detailField("progress")}
      </Group>
      <Group title="Code review">
        {detailField("code_review_comments")}
        {detailField("code_review_url")}
      </Group>
      <Group title="Description details">
        <Cell wide>
          <Label text="Description" />
          {descriptionField}
        </Cell>
        {detailField("description_url")}
      </Group>
    </section>
  );
});
