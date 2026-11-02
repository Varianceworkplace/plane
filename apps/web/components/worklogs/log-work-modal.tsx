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
import { CalendarOutline } from "@makeplane/propel/icons";
import { DateSelect } from "@plane/blocks/property-select";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useUserProfile } from "@/hooks/store/user";
// local imports
import { formatWorklogDuration, pad, toNumber, worklogService } from "./helpers";
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

type TErrors = Partial<Record<"started_at" | "ended_at" | "duration" | "description" | "error", string>>;

/** The end may run this far past the clock (matches the server's allowance for device drift). */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const toTimeValue = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Local date + "HH:MM" -> Date, or null until both are picked. */
const combine = (date: Date | null, time: string): Date | null => {
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
};

/** Whole minutes from start to end, or null when the range isn't usable yet. */
const spanMinutes = (start: Date | null, end: Date | null) =>
  start && end && end > start ? Math.floor((end.getTime() - start.getTime()) / 60000) : null;

export function LogWorkModal(props: Props) {
  const { open, workspaceSlug, projectId, issueId, worklog, onClose } = props;
  const isEdit = !!worklog;
  const { data: userProfile } = useUserProfile();
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<TErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const started = worklog?.started_at ? new Date(worklog.started_at) : null;
    const ended = worklog?.ended_at ? new Date(worklog.ended_at) : null;
    // entries logged before start / end were asked for keep the day they were logged on
    const fallbackDay = startOfDay(worklog ? new Date(worklog.created_at) : new Date());
    setStartDate(started ? startOfDay(started) : fallbackDay);
    setStartTime(started ? toTimeValue(started) : "");
    setEndDate(ended ? startOfDay(ended) : fallbackDay);
    setEndTime(ended ? toTimeValue(ended) : "");
    setHours(worklog ? String(Math.floor(worklog.duration / 60) || "") : "");
    setMinutes(worklog ? String(worklog.duration % 60 || "") : "");
    setDescription(worklog?.description ?? "");
    setErrors({});
  }, [open, worklog]);

  const start = combine(startDate, startTime);
  const end = combine(endDate, endTime);
  const span = spanMinutes(start, end);

  /** Apply a start / end change and fill the time spent with the new gap. */
  const updateRange = (next: {
    startDate?: Date | null;
    startTime?: string;
    endDate?: Date | null;
    endTime?: string;
  }) => {
    const nextStartDate = next.startDate !== undefined ? next.startDate : startDate;
    const nextStartTime = next.startTime ?? startTime;
    let nextEndDate = next.endDate !== undefined ? next.endDate : endDate;
    const nextEndTime = next.endTime ?? endTime;
    // moving the start past the end's day most likely means the end should follow it
    if (next.startDate && nextEndDate && next.startDate > nextEndDate) nextEndDate = next.startDate;
    setStartDate(nextStartDate);
    setStartTime(nextStartTime);
    setEndDate(nextEndDate);
    setEndTime(nextEndTime);

    const nextSpan = spanMinutes(combine(nextStartDate, nextStartTime), combine(nextEndDate, nextEndTime));
    if (nextSpan !== null && nextSpan > 0) {
      setHours(String(Math.floor(nextSpan / 60) || ""));
      setMinutes(String(nextSpan % 60 || ""));
    }
    setErrors({});
  };

  const validate = (): { duration: number; start: Date; end: Date } | null => {
    const next: TErrors = {};
    if (!start) next.started_at = "Pick the date and time you started.";
    if (!end) next.ended_at = "Pick the date and time you finished.";
    if (start && end && end <= start) next.ended_at = "The end must be after the start.";
    else if (end && end.getTime() > Date.now() + CLOCK_SKEW_MS)
      next.ended_at = "You can't log time that hasn't happened yet.";

    const h = toNumber(hours);
    const m = toNumber(minutes);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0)
      next.duration = "Enter whole numbers for hours and minutes.";
    else if (m > 59) next.duration = "Minutes must be between 0 and 59.";
    else if (h > 999) next.duration = "Hours can't be more than 999.";
    else if (h * 60 + m < 1) next.duration = "Enter the time you spent.";
    else if (span !== null && h * 60 + m > span)
      next.duration = `The time can't be more than the ${formatWorklogDuration(span)} between start and end.`;

    if (!description.trim()) next.description = "Add a note about the work you did.";

    setErrors(next);
    if (Object.keys(next).length || !start || !end) return null;
    return { duration: h * 60 + m, start, end };
  };

  const save = async () => {
    const valid = validate();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const payload = {
        duration: valid.duration,
        description: description.trim(),
        started_at: valid.start.toISOString(),
        ended_at: valid.end.toISOString(),
      };
      if (worklog) await worklogService.update(workspaceSlug, projectId, issueId, worklog.id, payload);
      else await worklogService.create(workspaceSlug, projectId, issueId, payload);
      setToast({ type: "success", title: isEdit ? "Worklog updated" : "Time logged", message: "" });
      onClose(true);
    } catch (err) {
      const data = (err ?? {}) as TErrors;
      setErrors(data);
      const message =
        data.started_at ||
        data.ended_at ||
        data.duration ||
        data.description ||
        data.error ||
        "Something went wrong. Please try again.";
      setToast({ type: "error", title: isEdit ? "Worklog not updated" : "Time not logged", message });
    } finally {
      setSaving(false);
    }
  };

  const renderMoment = (
    label: string,
    field: "started_at" | "ended_at",
    date: Date | null,
    time: string,
    onDate: (date: Date | null) => void,
    onTime: (time: string) => void
  ) => (
    <Field name={field} invalid={!!errors[field]}>
      <div className="flex flex-col gap-1.5">
        <FieldLabel size="md" inset={false}>
          {label}
        </FieldLabel>
        <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
          <div className="rounded-md border-[0.5px] border-subtle">
            <DateSelect
              variant="select-md"
              value={date}
              onChange={onDate}
              maxDate={new Date()}
              placeholder="Pick a date"
              icon={<CalendarOutline />}
              weekStartsOn={userProfile?.start_of_the_week}
            />
          </div>
          <InputGroup size="md">
            <Input
              size="md"
              type="time"
              aria-label={`${label} time`}
              value={time}
              onChange={(e) => onTime(e.target.value)}
            />
          </InputGroup>
        </div>
        {errors[field] && <span className="text-caption-md-regular text-danger-primary">{errors[field]}</span>}
      </div>
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose(false)}>
      <DialogContent size="md">
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {renderMoment(
                "Start",
                "started_at",
                startDate,
                startTime,
                (date) => updateRange({ startDate: date }),
                (time) => updateRange({ startTime: time })
              )}
              {renderMoment(
                "End",
                "ended_at",
                endDate,
                endTime,
                (date) => updateRange({ endDate: date }),
                (time) => updateRange({ endTime: time })
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-3">
                <Field name="hours" invalid={!!errors.duration}>
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
                          setErrors((prev) => ({ ...prev, duration: undefined }));
                        }}
                      />
                    </InputGroup>
                  </div>
                </Field>
                <Field name="minutes" invalid={!!errors.duration}>
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
                          setErrors((prev) => ({ ...prev, duration: undefined }));
                        }}
                      />
                    </InputGroup>
                  </div>
                </Field>
              </div>
              {errors.duration ? (
                <span className="text-caption-md-regular text-danger-primary">{errors.duration}</span>
              ) : (
                <span className="text-caption-md-regular text-tertiary">
                  {span !== null
                    ? `${formatWorklogDuration(span)} between start and end. Lower it if you took breaks.`
                    : "Filled in from the start and end times."}
                </span>
              )}
            </div>
            <Field name="description" invalid={!!errors.description}>
              <div className="flex flex-col gap-1.5">
                <FieldLabel size="md" inset={false}>
                  Note
                </FieldLabel>
                <TextAreaGroup resize="none">
                  <TextArea
                    size="lg"
                    surface="field"
                    autoResize
                    maxRows={8}
                    aria-label="Note"
                    placeholder="What did you work on?"
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setErrors((prev) => ({ ...prev, description: undefined }));
                    }}
                  />
                </TextAreaGroup>
                {errors.description && (
                  <span className="text-caption-md-regular text-danger-primary">{errors.description}</span>
                )}
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
