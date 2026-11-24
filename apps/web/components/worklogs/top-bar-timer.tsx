/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSWRConfig } from "swr";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { EditOutline, StopOutline } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
// local imports
import { formatTimerClock, refreshWorkItemTime, useWorklogTimer, worklogService } from "./helpers";
import type { TLocalIssueUpdate } from "./list-row-timer";
import { SaveTimerModal, useTimerSeconds } from "./timer-control";

/** Whether a list's work item ids (one list, lists per group, or per sub-group) include this work item. */
const listIncludes = (grouped: unknown, issueId: string): boolean => {
  if (Array.isArray(grouped)) return grouped.includes(issueId);
  if (grouped && typeof grouped === "object") return Object.values(grouped).some((ids) => listIncludes(ids, issueId));
  return false;
};

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
  const { mutate: globalMutate } = useSWRConfig();
  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  const { getStateById, fetchProjectStates } = useProjectState();
  const { rootIssueStore } = useIssueDetail();

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

  /** After the time is logged: the work item's time, and its new status (On Hold / Completed) wherever it shows. */
  const showSaved = (projectId: string, issueId: string, issueStateId?: string) => {
    void refreshWorkItemTime(globalMutate, projectId, issueId);
    const issue = rootIssueStore.issues.getIssueById(issueId);
    // not loaded on this page: it's fetched fresh when opened
    if (!issueStateId || !issue || issue.state_id === issueStateId) return;
    // On Hold may be new to the project
    if (!getStateById(issueStateId)) void fetchProjectStates(workspaceSlug, projectId);
    // in the list on screen: through the list's store, without syncing (the server already moved it), so it regroups
    const layoutStore = issues as unknown as TLocalIssueUpdate & { groupedIssueIds?: unknown };
    if (typeof layoutStore.issueUpdate === "function" && listIncludes(layoutStore.groupedIssueIds, issueId)) {
      void layoutStore.issueUpdate(workspaceSlug, projectId, issueId, { state_id: issueStateId }, false);
    } else rootIssueStore.issues.updateIssue(issueId, { state_id: issueStateId });
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
