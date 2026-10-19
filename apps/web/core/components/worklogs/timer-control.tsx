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
import { setToast } from "@plane/blocks/toast";
import { renderFormattedDate, renderFormattedTime } from "@plane/utils";
// local imports
import { formatTimerClock, formatWorklogDuration, useWorklogTimer, worklogService } from "./helpers";
import type { TWorklogTimer } from "./types";

/** Seconds on the timer, ticking every second while it runs. Corrects for client / server clock drift. */
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
  return (Date.now() + clockOffset - new Date(timer.started_at).getTime()) / 1000;
};

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  /** may this member start a timer on this work item */
  canStart: boolean;
  /** called after a timer has been saved as a worklog */
  onSaved: () => void;
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
          onClose={async (result) => {
            setSaveOpen(false);
            if (result === "saved" || result === "discarded") await mutate(null, { revalidate: false });
            if (result === "saved") onSaved();
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

/** Shown after Stop: date, start, end and total, plus the required note. */
function SaveTimerModal(props: {
  open: boolean;
  workspaceSlug: string;
  timer: TWorklogTimer;
  onClose: (result: "saved" | "discarded" | "cancelled") => void;
}) {
  const { open, workspaceSlug, timer, onClose } = props;
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDiscard(false);
  }, [open]);

  const end = timer.stopped_at ?? timer.server_now;
  const details: [string, string][] = [
    ["Work item", `${timer.project.identifier}-${timer.issue.sequence_id} ${timer.issue.name}`],
    ["Date", renderFormattedDate(timer.started_at) ?? ""],
    ["Start time", renderFormattedTime(timer.started_at, "12-hour")],
    ["End time", renderFormattedTime(end, "12-hour")],
    ["Total time", formatWorklogDuration(timer.duration)],
  ];

  const save = async () => {
    if (saving) return;
    if (!description.trim()) {
      setError("Describe the work completed or the changes you made.");
      return;
    }
    setSaving(true);
    try {
      await worklogService.saveTimer(workspaceSlug, description.trim());
      setDescription("");
      setToast({ type: "success", title: "Time logged", message: `${formatWorklogDuration(timer.duration)} saved.` });
      onClose("saved");
    } catch (err) {
      const data = (err ?? {}) as Record<string, string>;
      const message = data.description || data.error || "Something went wrong. Please try again.";
      setError(message);
      setToast({ type: "error", title: "Time not logged", message });
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    try {
      await worklogService.discardTimer(workspaceSlug);
      setDescription("");
      setToast({ type: "success", title: "Timer discarded", message: "No time was logged." });
      onClose("discarded");
    } catch {
      setToast({ type: "error", title: "Timer not discarded", message: "Please try again." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose("cancelled")}>
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
                    placeholder="Describe the work completed or the changes made to this work item"
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
            <button type="submit" className="hidden" tabIndex={-1} />
          </form>
        </DialogMain>
        <DialogActions>
          <div className="mr-auto">
            <Button
              stretch="auto"
              variant="danger-outline"
              size="md"
              label={confirmDiscard ? "Click again to discard" : "Discard"}
              onClick={() => void discard()}
            />
          </div>
          <Button stretch="auto" variant="secondary" size="md" label="Later" onClick={() => onClose("cancelled")} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label="Save time log"
            loading={saving}
            onClick={() => void save()}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
