/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { LinearProgress } from "@makeplane/propel/components/linear-progress";
import {
  AnalyticsOutline,
  CalendarOutline,
  CheckDoneOutline,
  ClockOutline,
  TimeTrackingOutline,
  WorkItemsOutline,
} from "@makeplane/propel/icons";
import { PriorityIcon } from "@plane/blocks/icons";
import { Loader } from "@plane/blocks/skeleton";
import { cn, getFileURL } from "@plane/utils";
// components
import { formatWorklogDuration, getWorklogUserName } from "@/components/worklogs/helpers";
// local imports
import { percentOf, useProjectSummary } from "./helpers";
import type { TProjectSummary, TProjectSummaryMember } from "./types";

const workItemCount = (count: number) => `${count} work ${count === 1 ? "item" : "items"}`;

type TTone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE_CHIP: Record<TTone, string> = {
  neutral: "bg-layer-2 text-secondary",
  accent: "bg-accent-subtle text-accent-primary",
  success: "bg-success-subtle text-success-primary",
  warning: "bg-warning-subtle text-warning-primary",
  danger: "bg-danger-subtle text-danger-primary",
};

function SummarySection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b-[0.5px] border-subtle pb-2">
        <h2 className="text-body-md-semibold text-primary">{title}</h2>
        {hint && <span className="text-body-xs-regular text-tertiary">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function SummaryTile({
  label,
  value,
  icon,
  caption,
  tone = "neutral",
  children,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  caption?: string;
  tone?: TTone;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border-[0.5px] border-subtle bg-layer-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-xs-medium text-secondary">{label}</span>
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", TONE_CHIP[tone])}>{icon}</span>
      </div>
      <span className="text-h3-semibold text-primary tabular-nums">{value}</span>
      {children}
      {caption && <span className="text-body-xs-regular text-tertiary">{caption}</span>}
    </div>
  );
}

function ModuleSummary({ summary }: { summary: TProjectSummary }) {
  const { work_items: items, priority, time } = summary;
  const countable = items.total - items.cancelled;
  const due = items.overdue + items.due_soon;
  const isOverExpected = time.expected_duration > 0 && time.worked_duration > time.expected_duration;
  const hoursOff = !time.is_time_tracking_enabled;

  let workedCaption = "Logged in worklogs";
  if (isOverExpected)
    workedCaption = `${formatWorklogDuration(time.worked_duration - time.expected_duration)} over expected`;
  else if (time.expected_duration > 0)
    workedCaption = `${percentOf(time.worked_duration, time.expected_duration)}% of expected`;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryTile
        label="Tasks open"
        value={items.open}
        icon={<WorkItemsOutline className="size-4" />}
        tone="accent"
        caption={`${workItemCount(items.total)} in total`}
      />
      <SummaryTile
        label="Progress"
        value={`${items.progress}%`}
        icon={<AnalyticsOutline className="size-4" />}
        tone="success"
        caption={`${items.completed} of ${countable} completed${items.cancelled ? `, ${items.cancelled} cancelled not counted` : ""}`}
      >
        <LinearProgress
          value={items.progress}
          size="sm"
          variant="success"
          showValue={false}
          aria-label="Project progress"
        />
      </SummaryTile>
      <SummaryTile
        label="Tasks due"
        value={due}
        icon={<CalendarOutline className="size-4" />}
        tone={items.overdue ? "danger" : items.due_soon ? "warning" : "neutral"}
        caption={`${items.overdue} overdue, ${items.due_soon} due in the next ${summary.due_soon_days} days`}
      />
      <SummaryTile
        label="Tasks completed"
        value={items.completed}
        icon={<CheckDoneOutline className="size-4" />}
        tone="success"
        caption={items.total ? `${percentOf(items.completed, items.total)}% of all work items` : "No work items yet"}
      />
      <SummaryTile
        label="High priority"
        value={priority.urgent + priority.high}
        icon={<PriorityIcon priority="high" className="size-4" />}
        caption={priority.urgent ? `Includes ${priority.urgent} urgent` : "Urgent and high"}
      />
      <SummaryTile
        label="Normal priority"
        value={priority.medium}
        icon={<PriorityIcon priority="medium" className="size-4" />}
        caption="Medium priority"
      />
      <SummaryTile
        label="Low priority"
        value={priority.low}
        icon={<PriorityIcon priority="low" className="size-4" />}
        caption="Low priority"
      />
      <SummaryTile
        label="Other priorities"
        value={priority.none}
        icon={<PriorityIcon priority="none" className="size-4" />}
        caption="No priority set"
      />
      <SummaryTile
        label="Expected hours"
        value={hoursOff ? "–" : formatWorklogDuration(time.expected_duration)}
        icon={<ClockOutline className="size-4" />}
        tone="accent"
        caption={hoursOff ? "Time tracking is off for this project" : "Expected time set on work items"}
      />
      <SummaryTile
        label="Worked hours"
        value={hoursOff ? "–" : formatWorklogDuration(time.worked_duration)}
        icon={<TimeTrackingOutline className="size-4" />}
        tone={isOverExpected ? "danger" : "success"}
        caption={hoursOff ? "Time tracking is off for this project" : workedCaption}
      >
        {!hoursOff && time.expected_duration > 0 && (
          <LinearProgress
            value={percentOf(time.worked_duration, time.expected_duration)}
            size="sm"
            variant={isOverExpected ? "danger" : "brand"}
            showValue={false}
            aria-label="Worked hours against expected hours"
          />
        )}
      </SummaryTile>
    </div>
  );
}

function HoursFigure({ label, minutes, className }: { label: string; minutes: number; className: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-layer-2 px-3 py-2">
      <span className="flex items-center gap-1.5 text-body-xs-regular text-tertiary">
        <span className={cn("size-1.5 rounded-full", className)} aria-hidden="true" />
        {label}
      </span>
      <span className="text-body-sm-semibold text-primary tabular-nums">{formatWorklogDuration(minutes)}</span>
    </div>
  );
}

function TeamMemberCard({ member }: { member: TProjectSummaryMember }) {
  const name = getWorklogUserName(member);
  const isOverExpected = member.expected_duration > 0 && member.worked_duration > member.expected_duration;
  const done = percentOf(member.completed_work_items, member.work_items);

  return (
    <div className="flex flex-col gap-3 rounded-lg border-[0.5px] border-subtle bg-layer-1 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar size="sm" src={getFileURL(member.avatar_url ?? "")} alt={name} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-body-sm-semibold text-primary">{name}</span>
          <span className="text-body-xs-regular text-tertiary">
            {workItemCount(member.work_items)}, {member.open_work_items} open
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <HoursFigure label="Expected" minutes={member.expected_duration} className="bg-accent-primary" />
        <HoursFigure
          label="Worked"
          minutes={member.worked_duration}
          className={isOverExpected ? "bg-danger-primary" : "bg-success-primary"}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <LinearProgress
          value={done}
          size="sm"
          variant="success"
          showValue={false}
          aria-label={`${name}: work items completed`}
        />
        <span className="text-body-xs-regular text-tertiary">
          {member.work_items
            ? `${member.completed_work_items} of ${member.work_items} completed (${done}%)`
            : "No work items assigned"}
        </span>
      </div>
    </div>
  );
}

function SummaryLoader() {
  return (
    <Loader className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <Loader.Item key={index} height="132px" width="100%" />
      ))}
    </Loader>
  );
}

type Props = {
  workspaceSlug: string;
  projectId: string;
};

export const ProjectSummaryRoot = observer(function ProjectSummaryRoot({ workspaceSlug, projectId }: Props) {
  const { summary, error, isLoading } = useProjectSummary(workspaceSlug, projectId);

  if (!summary) {
    return (
      <div className="px-page-x py-6">
        {error && !isLoading ? (
          <p className="text-body-sm-regular text-tertiary">
            {error?.error ?? "The project summary couldn't be loaded. Refresh the page to try again."}
          </p>
        ) : (
          <SummaryLoader />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 px-page-x py-6">
      <SummarySection title="Module summary">
        <ModuleSummary summary={summary} />
      </SummarySection>
      <SummarySection title="Team summary" hint="Expected and worked hours per person">
        {summary.team.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {summary.team.map((member) => (
              <TeamMemberCard key={member.id} member={member} />
            ))}
          </div>
        ) : (
          <p className="text-body-sm-regular text-tertiary">
            No one has work items or logged time in this project yet.
          </p>
        )}
      </SummarySection>
    </div>
  );
});
