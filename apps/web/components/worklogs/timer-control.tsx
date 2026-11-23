/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Field, FieldLabel } from "@makeplane/propel/components/field";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { PlayOutline, StopOutline } from "@makeplane/propel/icons";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
import { renderFormattedDate, renderFormattedTime } from "@plane/utils";
// local imports
import { formatTimerClock, formatWorklogDuration, useWorklogTimer, worklogService } from "./helpers";
import type { TWorklogTimer } from "./types";

/** How saving the time log leaves the task, as in Workplace's Notes (required). */
type TClosingStatus = { key: "on_hold" | "completed"; label: string };
const CLOSING_STATUSES: TClosingStatus[] = [
  { key: "on_hold", label: "On Hold" },
  { key: "completed", label: "Completed" },
];

/** Seconds on the timer, ticking every second while it runs. Corrects for client / server clock drift; time it stood
 * stopped before a Discard doesn't count. */
const useTimerSeconds = (timer: TWorklogTimer | null) => {
  const [, setTick] = useState(0);
  // server time minus local time, captured whenever fresh timer data arrives
  const clockOffset = useMemo(
    () => (timer ? new Date(timer.server_now).getTime() - Date.now() : 0),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [timer?.server_now]
  );
  useEffect(() => {
    if (!timer?.is_running) return;
    const interval = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(interval);
  }, [timer?.is_running]);
  if (!timer) return 0;
  if (!timer.is_running) return timer.elapsed_seconds;
  return (Date.now() + clockOffset - new Date(timer.started_at).getTime()) / 1000 - timer.paused_seconds;
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  /** may this member start a timer on this work item */
  canStart: boolean;
  /** called after a timer has been saved as a worklog, with the task's status after it (On Hold / Completed) */
  onSaved: (issueStateId?: string) => void;
  /** smaller trigger for rows of the work item list */
  compact?: boolean;
};

/** Start / Stop timer for a work item, shown next to "Log work". */
export function WorklogTimerControl(props: Props) {
  const { workspaceSlug, projectId, issueId, canStart, onSaved, compact = false } = props;
  const { timer, mutate } = useWorklogTimer(workspaceSlug);
  const seconds = useTimerSeconds(timer);
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const isThisIssue = timer?.issue.id === issueId;
  const timerKey = timer ? `${timer.project.identifier}-${timer.issue.sequence_id}` : "";

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const started = await worklogService.startTimer(workspaceSlug, projectId, issueId);
      await mutate(started, { revalidate: false });
      setToast({ type: "success", title: "Timer started", message: "Press Stop when you finish." });
    } catch (err) {
      const data = (err ?? {}) as { error?: string; timer?: TWorklogTimer | null };
      if (data.timer) await mutate(data.timer, { revalidate: false });
      setToast({ type: "error", title: "Timer not started", message: data.error ?? "Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const stopped = await worklogService.stopTimer(workspaceSlug);
      await mutate(stopped, { revalidate: false });
      setSaveOpen(true);
    } catch (err) {
      const data = (err ?? {}) as { error?: string };
      setToast({ type: "error", title: "Timer not stopped", message: data.error ?? "Please try again." });
      void mutate();
    } finally {
      setBusy(false);
    }
  };

  // a timer runs (or waits for its note) on another work item
  if (timer && !isThisIssue) {
    if (!canStart) return null;
    if (compact) {
      const message = `Your timer is on ${timerKey}: ${timer.issue.name}. Stop it there before starting a new one.`;
      return (
        <Tooltip label={message}>
          <span className="inline-flex opacity-50">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<Icon icon={PlayOutline} />}
              aria-label="Start timer"
              onClick={() => {
                setToast({ type: "info", title: "Timer already running", message });
              }}
            />
          </span>
        </Tooltip>
      );
    }
    return (
      <Tooltip label={`Your timer is on ${timerKey}: ${timer.issue.name}. Stop it there before starting a new one.`}>
        <Link
          href={`/${workspaceSlug}/browse/${timerKey}/`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border-[0.5px] border-subtle px-2 text-caption-md-regular text-secondary hover:bg-layer-transparent-hover"
        >
          <span
            className={`size-2 rounded-full ${timer.is_running ? "animate-pulse bg-danger-primary" : "bg-warning-primary"}`}
          />
          <span className="font-medium tabular-nums">{formatTimerClock(seconds)}</span>
          <span>on {timerKey}</span>
        </Link>
      </Tooltip>
    );
  }

  // the timer on this work item
  if (timer && isThisIssue) {
    return (
      <>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex h-7 items-center gap-1.5 rounded-md border-[0.5px] border-subtle px-2 text-caption-md-regular text-primary"
            aria-live="polite"
          >
            <span
              className={`size-2 rounded-full ${timer.is_running ? "animate-pulse bg-danger-primary" : "bg-warning-primary"}`}
            />
            <span className="font-medium tabular-nums">{formatTimerClock(seconds)}</span>
            {!timer.is_running && <span className="text-tertiary">stopped</span>}
          </span>
          {timer.is_running ? (
            <Button
              stretch="auto"
              variant="danger"
              size="sm"
              label="Stop"
              icon={<Icon icon={StopOutline} />}
              loading={busy}
              onClick={() => void stop()}
            />
          ) : (
            <Button stretch="auto" variant="primary" size="sm" label="Add note" onClick={() => setSaveOpen(true)} />
          )}
        </div>
        <SaveTimerModal
          open={saveOpen}
          workspaceSlug={workspaceSlug}
          timer={timer}
          onClose={async (result, resumed, issueStateId) => {
            setSaveOpen(false);
            if (result === "resumed") await mutate(resumed, { revalidate: false });
            if (result === "saved" || result === "discarded") await mutate(null, { revalidate: false });
            if (result === "saved") onSaved(issueStateId);
          }}
        />
      </>
    );
  }

  if (!canStart) return null;
  if (compact) {
    return (
      <Tooltip label="Start timer">
        <IconButton
          variant="secondary"
          size="sm"
          icon={<Icon icon={PlayOutline} />}
          aria-label="Start timer"
          loading={busy}
          onClick={() => void start()}
        />
      </Tooltip>
    );
  }
  return (
    <Button
      stretch="auto"
      variant="secondary"
      size="sm"
      label="Start timer"
      icon={<Icon icon={PlayOutline} />}
      loading={busy}
      onClick={() => void start()}
    />
  );
}

/** Shown after Stop: date, start, end and total, plus the required note and how the task is left (On Hold or
 * Completed, as in Workplace). It closes only by saving the time log or by Discard (the timer runs on); there's no
 * putting it off or deleting the timer. */
function SaveTimerModal(props: {
  open: boolean;
  workspaceSlug: string;
  timer: TWorklogTimer;
  /** `resumed` is the running timer after Discard; `issueStateId` the task's status after saving */
  onClose: (result: "saved" | "resumed" | "discarded", resumed?: TWorklogTimer, issueStateId?: string) => void;
}) {
  const { open, workspaceSlug, timer, onClose } = props;
  const [description, setDescription] = useState("");
  const [closingStatus, setClosingStatus] = useState<TClosingStatus | null>(null);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setStatusError("");
    setClosingStatus(null);
  }, [open]);

  const end = timer.stopped_at ?? timer.server_now;
  const details: [string, string][] = [
    ["Project task", `${timer.project.identifier}-${timer.issue.sequence_id} ${timer.issue.name}`],
    ["Date", renderFormattedDate(timer.started_at) ?? ""],
    ["Start time", renderFormattedTime(timer.started_at, "12-hour")],
    ["End time", renderFormattedTime(end, "12-hour")],
    ["Total time", formatWorklogDuration(timer.duration)],
  ];

  const save = async () => {
    if (saving) return;
    const missingNote = !description.trim();
    if (missingNote) setError("Describe the work completed or the changes you made.");
    if (!closingStatus) setStatusError("Pick a status: On Hold or Completed.");
    if (missingNote || !closingStatus) return;
    setSaving(true);
    try {
      const saved = await worklogService.saveTimer(workspaceSlug, description.trim(), closingStatus.key);
      setDescription("");
      setToast({
        type: "success",
        title: "Time logged",
        message: `${formatWorklogDuration(timer.duration)} saved. The task is now ${closingStatus.label}.`,
      });
      onClose("saved", undefined, saved.issue_state_id);
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      if (data.status) setStatusError(data.status);
      const message = data.description || data.status || data.error || "Something went wrong. Please try again.";
      if (!data.status) setError(message);
      setToast({ type: "error", title: "Time not logged", message });
    } finally {
      setSaving(false);
    }
  };

  // Discard takes the Stop back: the timer runs on from the time it had, the stopped time doesn't count
  const discard = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      const { timer: resumed, reason } = await worklogService.resumeTimer(workspaceSlug);
      if (resumed) {
        setToast({
          type: "success",
          title: "Timer resumed",
          message: `Continuing from ${formatTimerClock(resumed.elapsed_seconds)}.`,
        });
        onClose("resumed", resumed);
      } else {
        setDescription("");
        setToast({
          type: "info",
          title: "Timer discarded",
          message: `${reason ?? ""} The timer can't continue, so it was removed. No time was logged.`.trim(),
        });
        onClose("discarded");
      }
    } catch (err) {
      const data = (err ?? {}) as { error?: string };
      setToast({ type: "error", title: "Timer not resumed", message: data.error ?? "Please try again." });
    } finally {
      setResuming(false);
    }
  };

  return (
    // Escape and clicks outside don't close it: the time is saved, or Discard takes the Stop back
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>Save time log</DialogTitle>
        </div>
        <DialogMain>
          <form
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-md border-[0.5px] border-subtle bg-layer-1 px-4 py-3 text-body-xs-regular">
              {details.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-tertiary">{label}</dt>
                  <dd className={label === "Total time" ? "font-medium text-primary" : "truncate text-primary"}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <Field name="description" invalid={!!error}>
              <div className="flex flex-col gap-1.5">
                <FieldLabel size="md" inset={false} required>
                  Description / notes
                </FieldLabel>
                <TextAreaGroup resize="none">
                  <TextArea
                    size="lg"
                    surface="field"
                    autoResize
                    maxRows={10}
                    placeholder="Describe the work completed or the changes made to this project task"
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setError("");
                    }}
                  />
                </TextAreaGroup>
                {error && <span className="text-caption-md-regular text-danger-primary">{error}</span>}
              </div>
            </Field>
            <Field name="status" invalid={!!statusError}>
              <div className="flex flex-col gap-1.5">
                <FieldLabel size="md" inset={false} required>
                  Status
                </FieldLabel>
                <div className="rounded-md border-[0.5px] border-subtle">
                  <Select<TClosingStatus>
                    getValues={() => CLOSING_STATUSES}
                    value={closingStatus}
                    onChange={(key) => {
                      setClosingStatus(CLOSING_STATUSES.find((option) => option.key === key) ?? null);
                      setStatusError("");
                    }}
                    // names the picker for screen readers: "Status, On Hold"
                    placeholder="Status"
                    getOptionValue={(option) => option.key}
                    getOptionLabel={(option) => option.label}
                    showSearch={false}
                    pinSelected={false}
                  >
                    <Select.Trigger<TClosingStatus> variant="select-md" className="w-full" aria-label="Status">
                      <span className="truncate text-left">
                        {closingStatus?.label ?? <span className="text-placeholder">Select a status</span>}
                      </span>
                    </Select.Trigger>
                  </Select>
                </div>
                {statusError && <span className="text-caption-md-regular text-danger-primary">{statusError}</span>}
              </div>
            </Field>
            <button type="submit" className="hidden" tabIndex={-1} />
          </form>
        </DialogMain>
        <DialogActions>
          <div className="flex w-full flex-wrap items-center justify-end gap-3">
            <div className="mr-auto flex items-center gap-2">
              <Button
                stretch="auto"
                variant="danger-outline"
                size="md"
                label="Discard"
                loading={resuming}
                onClick={() => void discard()}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                stretch="auto"
                variant="primary"
                size="md"
                label="Save time log"
                loading={saving}
                onClick={() => void save()}
              />
            </div>
          </div>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
