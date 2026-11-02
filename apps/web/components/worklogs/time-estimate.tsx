/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useSWRConfig } from "swr";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Field, FieldLabel } from "@makeplane/propel/components/field";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { Popover, PopoverBody, PopoverContent, PopoverTrigger } from "@makeplane/propel/components/popover";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { setToast } from "@plane/blocks/toast";
import type { TIssue } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
// local imports
import {
  formatWorklogDuration,
  projectTimeEstimatesKey,
  toNumber,
  useIssueTimeEstimate,
  useIssueWorklogs,
  useProjectTimeEstimates,
  worklogService,
} from "./helpers";
import type { TWorkItemTimeEstimate, TWorkItemTimeEstimatePayload } from "./types";

/** "38m of 2h", "38m logged" without an estimate */
const describe = (worked: number, expected: number | null) =>
  expected
    ? `${formatWorklogDuration(worked)} of ${formatWorklogDuration(expected)}`
    : `${formatWorklogDuration(worked)} logged`;

function ProgressBar({ worked, expected }: { worked: number; expected: number }) {
  const over = worked > expected;
  // when over, the filled part is the estimate's share of the worked time and the red rest is the overrun
  const width = over ? (expected / worked) * 100 : (worked / expected) * 100;
  return (
    <span
      className={cn(
        "relative block h-1 w-full overflow-hidden rounded-full",
        over ? "bg-danger-primary" : "bg-layer-3"
      )}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-accent-primary"
        style={{ width: `${Math.min(width, 100)}%` }}
      />
    </span>
  );
}

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
};

/** Sidebar property: worked vs expected time, with a popover to set the expected time and an overrun reason. */
export function WorkItemTimeEstimate(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled = false } = props;
  const { mutate } = useSWRConfig();
  const { estimate, mutate: mutateEstimate } = useIssueTimeEstimate(workspaceSlug, projectId, issueId);
  // the worklog list is already refreshed whenever time is logged, so the worked total follows it live
  const { worklogs } = useIssueWorklogs(workspaceSlug, projectId, issueId);
  const [isOpen, setIsOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const worked = worklogs ? worklogs.reduce((sum, w) => sum + w.duration, 0) : (estimate?.worked_duration ?? 0);
  const expected = estimate?.expected_duration ?? null;
  const overBy = expected ? Math.max(worked - expected, 0) : 0;

  const openEditor = (open: boolean) => {
    if (open) {
      setHours(expected ? String(Math.floor(expected / 60) || "") : "");
      setMinutes(expected ? String(expected % 60 || "") : "");
      setReason(estimate?.overdue_reason ?? "");
      setError("");
    }
    setIsOpen(open);
  };

  const save = async (payload: TWorkItemTimeEstimatePayload) => {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await worklogService.updateTimeEstimate(workspaceSlug, projectId, issueId, payload);
      await mutateEstimate(updated, { revalidate: false });
      void mutate(projectTimeEstimatesKey(projectId));
      setIsOpen(false);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      const message = data.expected_duration || data.overdue_reason || data.error || "Something went wrong.";
      setError(message);
      setToast({ type: "error", title: "Expected time not saved", message });
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const h = toNumber(hours);
    const m = toNumber(minutes);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0) return setError("Enter whole numbers.");
    if (m > 59) return setError("Minutes must be between 0 and 59.");
    if (h > 999) return setError("Hours can't be more than 999.");
    if (h * 60 + m < 1) return setError("Enter the expected time.");
    const total = h * 60 + m;
    // the reason only matters (and is only shown) once the work runs over
    void save(total < worked ? { expected_duration: total, overdue_reason: reason } : { expected_duration: total });
  };

  const summary = (
    <span className="flex w-full min-w-0 flex-col gap-1 text-left">
      <span className="flex items-center gap-1.5 text-body-xs-regular">
        <span className={cn("font-medium", overBy ? "text-danger-primary" : "text-primary")}>
          {describe(worked, expected)}
        </span>
        {overBy > 0 && <span className="text-danger-primary">· {formatWorklogDuration(overBy)} over</span>}
        {!expected && !disabled && <span className="text-placeholder">· Set expected</span>}
      </span>
      {expected && <ProgressBar worked={worked} expected={expected} />}
    </span>
  );

  if (disabled)
    return (
      <div className="flex w-full flex-col gap-1 px-2 py-0.5">
        {summary}
        {overBy > 0 && estimate?.overdue_reason && (
          <span className="text-caption-md-regular text-tertiary">Reason: {estimate.overdue_reason}</span>
        )}
      </div>
    );

  return (
    <Popover open={isOpen} onOpenChange={openEditor}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex w-full flex-col gap-1 rounded-sm px-2 py-1 hover:bg-layer-transparent-hover"
            aria-label="Expected time"
          />
        }
      >
        {summary}
        {overBy > 0 && estimate?.overdue_reason && (
          <span className="truncate text-left text-caption-md-regular text-tertiary">
            Reason: {estimate.overdue_reason}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent variant="rich" side="bottom" align="start" sideOffset={6}>
        <PopoverBody>
          <form
            className="flex w-72 flex-col gap-3 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-body-sm-medium text-primary">Expected time</span>
              <span className="text-caption-md-regular text-tertiary">
                {formatWorklogDuration(worked)} logged so far
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field name="expected-hours" invalid={!!error}>
                <div className="flex flex-col gap-1">
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
              <Field name="expected-minutes" invalid={!!error}>
                <div className="flex flex-col gap-1">
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
            {toNumber(hours) * 60 + toNumber(minutes) > 0 && toNumber(hours) * 60 + toNumber(minutes) < worked && (
              <Field name="overdue-reason">
                <div className="flex flex-col gap-1">
                  <FieldLabel size="md" inset={false}>
                    Why did it take longer?
                  </FieldLabel>
                  <TextAreaGroup resize="none">
                    <TextArea
                      size="md"
                      surface="field"
                      autoResize
                      maxRows={5}
                      aria-label="Why did it take longer?"
                      placeholder="e.g. The client added two screens"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </TextAreaGroup>
                </div>
              </Field>
            )}
            {error && <span className="text-caption-md-regular text-danger-primary">{error}</span>}
            <div className="flex items-center justify-between gap-2">
              {expected ? (
                <Button
                  stretch="auto"
                  variant="ghost"
                  size="sm"
                  label="Remove"
                  disabled={saving}
                  onClick={() => void save({ expected_duration: null })}
                />
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button stretch="auto" variant="secondary" size="sm" label="Cancel" onClick={() => setIsOpen(false)} />
                <Button stretch="auto" variant="primary" size="sm" label="Save" loading={saving} onClick={submit} />
              </div>
            </div>
            <button type="submit" className="hidden" tabIndex={-1} />
          </form>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

/** "38m / 2h" next to a list row's properties; red once the work runs over. */
export const ListRowTimeEstimate = observer(function ListRowTimeEstimate(props: { issue: TIssue }) {
  const { issue } = props;
  const { workspaceSlug: routeSlug } = useParams();
  const workspaceSlug = typeof routeSlug === "string" ? routeSlug : "";
  const { getProjectById } = useProject();
  const projectId = issue.project_id ?? "";
  const enabled = !!(projectId && getProjectById(projectId)?.is_time_tracking_enabled);
  const estimates = useProjectTimeEstimates(workspaceSlug, projectId, enabled);
  const estimate: TWorkItemTimeEstimate | undefined = estimates?.[issue.id];
  if (!enabled || !estimate || (!estimate.expected_duration && !estimate.worked_duration)) return null;

  const { worked_duration: worked, expected_duration: expected, over_by: overBy } = estimate;
  const label = expected
    ? `${formatWorklogDuration(worked)} / ${formatWorklogDuration(expected)}`
    : formatWorklogDuration(worked);
  const tooltip = expected
    ? `Worked ${formatWorklogDuration(worked)} of ${formatWorklogDuration(expected)} expected` +
      (overBy ? ` · ${formatWorklogDuration(overBy)} over` : "")
    : `Worked ${formatWorklogDuration(worked)} · no expected time set`;

  return (
    <Tooltip label={tooltip}>
      <span
        className={cn(
          "flex h-5 flex-shrink-0 items-center rounded-sm border-[0.5px] px-1.5 text-caption-md-medium",
          overBy ? "border-danger-subtle text-danger-primary" : "border-subtle text-secondary"
        )}
      >
        {label}
      </span>
    </Tooltip>
  );
});
