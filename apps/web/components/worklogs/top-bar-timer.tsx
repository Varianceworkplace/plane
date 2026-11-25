/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { EditOutline, StopOutline } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
// local imports
import { formatTimerClock, useWorklogTimer, worklogService } from "./helpers";
import { SaveTimerModal, useTimerSeconds } from "./timer-control";
import { useShowSavedTime } from "./use-show-saved-time";

/** The member's timer in the top bar, on every page: the time, the work item it's on (a link to it), and Stop, which
 * opens the same Save time log dialog as Stop in the work item list. Nothing shows without a timer. */
export const TopBarWorklogTimer = observer(function TopBarWorklogTimer() {
  const { workspaceSlug: routeSlug } = useParams();
  const workspaceSlug = typeof routeSlug === "string" ? routeSlug : "";
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  // store hooks
  const { timer, mutate } = useWorklogTimer(workspaceSlug);
  const seconds = useTimerSeconds(timer);
  const showSaved = useShowSavedTime(workspaceSlug);

  if (!workspaceSlug || !timer) return null;

  const timerKey = `${timer.project.identifier}-${timer.issue.sequence_id}`;
  const workItemLabel = `${timerKey}: ${timer.issue.name}`;

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

  const clock = formatTimerClock(seconds);

  // The bar is tight: from 1024px the time, the work item and labelled buttons; from 768px the time and icon
  // buttons; below that the icon button alone (its tooltip has the time).
  return (
    <div className="mr-1 flex shrink-0 items-center gap-1.5">
      <Tooltip
        side="bottom"
        label={
          timer.is_running
            ? `Your timer is running on ${workItemLabel}`
            : `Your timer is stopped on ${workItemLabel}. Add a note to save the time.`
        }
      >
        <Link
          href={`/${workspaceSlug}/browse/${timerKey}/`}
          aria-label={`${timer.is_running ? "Timer running" : "Timer stopped"} on ${workItemLabel}`}
          className="hidden h-7 items-center gap-1.5 rounded-md border-[0.5px] border-subtle px-2 text-caption-md-regular text-secondary hover:bg-layer-transparent-hover md:inline-flex"
        >
          <span
            className={`size-2 shrink-0 rounded-full ${timer.is_running ? "animate-pulse bg-danger-primary" : "bg-warning-primary"}`}
          />
          <span className="font-medium text-primary tabular-nums">{clock}</span>
          <span className="hidden max-w-24 truncate lg:inline">{timerKey}</span>
        </Link>
      </Tooltip>
      {timer.is_running ? (
        <>
          <span className="hidden lg:inline-flex">
            <Button
              stretch="auto"
              variant="danger"
              size="sm"
              label="Stop"
              icon={<Icon icon={StopOutline} />}
              loading={busy}
              onClick={() => void stop()}
            />
          </span>
          <span className="inline-flex lg:hidden">
            <Tooltip side="bottom" label={`Stop timer (${clock} on ${timerKey})`}>
              <IconButton
                variant="danger"
                size="sm"
                icon={<Icon icon={StopOutline} />}
                aria-label="Stop timer"
                loading={busy}
                onClick={() => void stop()}
              />
            </Tooltip>
          </span>
        </>
      ) : (
        <>
          <span className="hidden lg:inline-flex">
            <Button stretch="auto" variant="primary" size="sm" label="Add note" onClick={() => setSaveOpen(true)} />
          </span>
          <span className="inline-flex lg:hidden">
            <Tooltip side="bottom" label={`Add a note to save the time (${clock} on ${timerKey})`}>
              <IconButton
                variant="primary"
                size="sm"
                icon={<Icon icon={EditOutline} />}
                aria-label="Add note"
                onClick={() => setSaveOpen(true)}
              />
            </Tooltip>
          </span>
        </>
      )}
      <SaveTimerModal
        open={saveOpen}
        workspaceSlug={workspaceSlug}
        timer={timer}
        onClose={async (result, resumed, issueStateId) => {
          const { project, issue } = timer;
          setSaveOpen(false);
          if (result === "resumed") await mutate(resumed, { revalidate: false });
          if (result === "saved" || result === "discarded") await mutate(null, { revalidate: false });
          if (result === "saved") showSaved(project.id, issue.id, issueStateId);
        }}
      />
    </div>
  );
});
