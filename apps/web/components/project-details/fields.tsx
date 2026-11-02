/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
// plane imports
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { CalendarOutline } from "@makeplane/propel/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { cn, getDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { MemberSelect } from "@/components/dropdowns/member/member-select";
import { PicklistSelect } from "@/components/task-details/field-input";
// hooks
import { useUserProfile } from "@/hooks/store/user";
// local imports
import { PROJECT_DETAIL_LABELS, REQUIRED_PROJECT_DETAIL_FIELDS, useProjectDetailOptions } from "./helpers";
import type { TProjectDetailFormErrors, TProjectDetailFormKey, TProjectDetailFormValues } from "./types";

type TTextKey = "related_to" | "customer_name" | "user_manual_url" | "project_url";
type TDateKey = "start_date" | "target_end_date" | "actual_end_date";

const TEXT_PLACEHOLDERS: Record<TTextKey, string> = {
  related_to: "Organization or contact",
  customer_name: "Customer's name",
  user_manual_url: "https://",
  project_url: "https://",
};

type Props = {
  workspaceSlug: string;
  values: TProjectDetailFormValues;
  onChange: (patch: Partial<TProjectDetailFormValues>) => void;
  errors: TProjectDetailFormErrors;
  /** a field's red outline goes away as soon as it's changed */
  onClearError: (key: TProjectDetailFormKey) => void;
  /** "Assigned To" is the project's lead */
  lead: string | null;
  onLeadChange: (lead: string | null) => void;
  /** limits "Assigned To" to the project's members (settings); the create form offers the whole workspace */
  projectId?: string;
  disabled?: boolean;
};

/** Message under a field Save flagged; also the anchor the form scrolls to. */
function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <span data-project-detail-error className="text-caption-md-regular text-danger-primary">
      {message}
    </span>
  );
}

function FieldShell(props: {
  name: TProjectDetailFormKey;
  error: string | undefined;
  wide?: boolean;
  bordered?: boolean;
  children: ReactNode;
}) {
  const { name, error, wide = false, bordered = false, children } = props;
  return (
    <div className={cn("flex flex-col gap-1.5", wide && "sm:col-span-2")}>
      <span className="text-body-xs-medium text-secondary">
        {PROJECT_DETAIL_LABELS[name]}
        {REQUIRED_PROJECT_DETAIL_FIELDS.includes(name) && <span className="text-danger-primary"> *</span>}
      </span>
      {bordered ? (
        <div className={cn("rounded-md border-[0.5px]", error ? "border-danger-strong" : "border-subtle")}>
          {children}
        </div>
      ) : (
        children
      )}
      <FieldError message={error} />
    </div>
  );
}

/** The Workplace "Creating New Project" fields, in a two-column grid. */
export const ProjectDetailFields = observer(function ProjectDetailFields(props: Props) {
  const {
    workspaceSlug,
    values,
    onChange,
    errors,
    onClearError,
    lead,
    onLeadChange,
    projectId,
    disabled = false,
  } = props;
  const options = useProjectDetailOptions(workspaceSlug);
  const { data: userProfile } = useUserProfile();

  const change = (key: keyof TProjectDetailFormValues, value: TProjectDetailFormValues[typeof key]) => {
    onChange({ [key]: value });
    onClearError(key);
  };

  const dateField = (key: TDateKey, limit: { minDate?: Date; maxDate?: Date }) => (
    <FieldShell name={key} error={errors[key]} bordered>
      <DateSelect
        value={getDate(values[key]) ?? null}
        onChange={(date) => change(key, (date && renderFormattedPayloadDate(date)) || null)}
        {...limit}
        placeholder={`Select ${PROJECT_DETAIL_LABELS[key].toLowerCase()}`}
        icon={<CalendarOutline />}
        weekStartsOn={userProfile?.start_of_the_week}
        clearable
        disabled={disabled}
        variant="select-md"
        className="w-full"
      />
    </FieldShell>
  );

  const textField = (key: TTextKey) => (
    <FieldShell name={key} error={errors[key]}>
      <InputGroup size="md">
        <Input
          size="md"
          aria-label={PROJECT_DETAIL_LABELS[key]}
          aria-invalid={!!errors[key] || undefined}
          placeholder={TEXT_PLACEHOLDERS[key]}
          value={values[key]}
          disabled={disabled}
          onChange={(e) => change(key, e.target.value)}
        />
      </InputGroup>
    </FieldShell>
  );

  const picklistField = (key: "project_type" | "status") => (
    <FieldShell name={key} error={errors[key]}>
      <PicklistSelect
        options={(options?.[key] ?? []).map((option) => ({ id: option, label: option }))}
        value={values[key]}
        onChange={(id) => change(key, id)}
        placeholder={`Select ${PROJECT_DETAIL_LABELS[key].toLowerCase()}`}
        mode="form"
        disabled={disabled}
        invalid={!!errors[key]}
      />
    </FieldShell>
  );

  const startDate = getDate(values.start_date) ?? undefined;

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      <FieldShell name="project_lead" error={errors.project_lead} bordered>
        <MemberSelect
          projectId={projectId}
          value={lead}
          onChange={(id) => {
            onLeadChange(id || null);
            onClearError("project_lead");
          }}
          placeholder="Select a person"
          clearable
          clearLabel="No one"
          disabled={disabled}
          variant="select-md"
          className="w-full"
        />
      </FieldShell>
      {dateField("start_date", { maxDate: getDate(values.target_end_date) ?? undefined })}
      {dateField("target_end_date", { minDate: startDate })}
      {dateField("actual_end_date", { minDate: startDate })}
      {picklistField("project_type")}
      {picklistField("status")}
      <FieldShell name="estimated_hours" error={errors.estimated_hours}>
        <InputGroup size="md">
          <Input
            size="md"
            inputMode="decimal"
            aria-label={PROJECT_DETAIL_LABELS.estimated_hours}
            aria-invalid={!!errors.estimated_hours || undefined}
            placeholder="e.g. 120"
            value={values.estimated_hours}
            disabled={disabled}
            onChange={(e) => change("estimated_hours", e.target.value.replace(/[^\d.]/g, ""))}
          />
        </InputGroup>
      </FieldShell>
      <FieldShell name="progress" error={errors.progress}>
        <PicklistSelect
          options={(options?.progress ?? []).map((option) => ({ id: String(option), label: `${option}%` }))}
          value={values.progress === null ? "" : String(values.progress)}
          onChange={(id) => change("progress", id ? Number(id) : null)}
          placeholder="Select progress"
          mode="form"
          disabled={disabled}
        />
      </FieldShell>
      {textField("customer_name")}
      {textField("related_to")}
      {textField("user_manual_url")}
      {textField("project_url")}
      <FieldShell name="salesforce_org_id" error={errors.salesforce_org_id} wide>
        <TextAreaGroup resize="none">
          <TextArea
            size="md"
            surface="field"
            autoResize
            maxRows={4}
            aria-label={PROJECT_DETAIL_LABELS.salesforce_org_id}
            placeholder="Salesforce org ID"
            value={values.salesforce_org_id}
            disabled={disabled}
            onChange={(e) => change("salesforce_org_id", e.target.value)}
          />
        </TextAreaGroup>
      </FieldShell>
    </div>
  );
});
