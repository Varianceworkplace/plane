/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
// plane imports
import { Avatar } from "@makeplane/propel/components/avatar";
import { Button } from "@makeplane/propel/components/button";
import { ClockOutline, InfoOutline, TextOutline } from "@makeplane/propel/icons";
import { cn, getFileURL, renderFormattedDate, renderFormattedTime } from "@plane/utils";
// components
import { formatWorklogDuration } from "@/components/worklogs/helpers";
import type { TWorklogUser } from "@/components/worklogs/types";
// services
import { TimesheetService } from "@/services/timesheet.service";
// local imports
import { timesheetListHref } from "./list-location";
import type { TTimesheetEntry } from "./types";

const timesheetService = new TimesheetService();

const DATE = "dd-MM-yyyy";
const EMPTY = <span className="text-placeholder">—</span>;

/** The SWR key of an entry, shared with the Time Sheet header (its breadcrumb shows the Timesheet No.). */
export const timesheetEntryKey = (workspaceSlug: string, entryId: string) => [
  "TIMESHEET_ENTRY",
  workspaceSlug,
  entryId,
];

export const useTimesheetEntry = (workspaceSlug: string, entryId: string | undefined) =>
  useSWR(
    workspaceSlug && entryId ? timesheetEntryKey(workspaceSlug, entryId) : null,
    () => timesheetService.retrieve(workspaceSlug, entryId as string),
    { revalidateOnFocus: false }
  );

const personName = (user: TWorklogUser) =>
  `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.display_name;

/** "27-11-2026 10:30 AM" */
const dateTime = (value: string | null | undefined) =>
  value ? `${renderFormattedDate(value, DATE) ?? ""} ${renderFormattedTime(value, "12-hour")}`.trim() : null;

/** The description with its web addresses as links (Workplace's "GIT merge request: https://…" among them). */
function DescriptionText(props: { text: string }) {
  // each piece keyed by where it starts in the text (the empty ones around a link left out)
  let at = 0;
  const pieces = props.text
    .split(/(https?:\/\/[^\s]+)/g)
    .map((part) => {
      const piece = { part, at };
      at += part.length;
      return piece;
    })
    .filter((piece) => piece.part);
  return (
    <span className="break-words whitespace-pre-wrap">
      {pieces.map(({ part, at: key }) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={key}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline"
          >
            {part}
          </a>
        ) : (
          <span key={key}>{part}</span>
        )
      )}
    </span>
  );
}

type TField = { label: string; value: ReactNode };

/**
 * Two fields side by side, label then value, as in Workplace's detail view; one under the other on a phone. A row of
 * one field (the description) takes the whole width.
 */
function FieldRow(props: { fields: [TField, TField?] }) {
  const fields = props.fields.filter((field): field is TField => !!field);
  return (
    <div
      className={cn(
        "grid grid-cols-1 border-t-[0.5px] border-subtle first:border-t-0",
        fields.length > 1 && "md:grid-cols-2"
      )}
    >
      {fields.map((field, index) => (
        <div
          key={field.label}
          className={cn(
            "flex min-w-0",
            index > 0 && "border-t-[0.5px] border-subtle md:border-t-0 md:border-l-[0.5px]"
          )}
        >
          <dt className="w-36 shrink-0 bg-layer-1 px-3 py-2.5 text-right text-body-xs-regular text-tertiary sm:w-44">
            {field.label}
          </dt>
          <dd className="min-w-0 flex-1 px-3 py-2.5 text-body-xs-regular text-primary">{field.value ?? EMPTY}</dd>
        </div>
      ))}
    </div>
  );
}

function Section(props: { icon: React.FC<{ className?: string }>; title: string; children: ReactNode }) {
  const { icon: SectionIcon, title, children } = props;
  return (
    <section className="overflow-hidden rounded-lg border-[0.5px] border-subtle">
      <h3 className="flex items-center gap-2 border-b-[0.5px] border-subtle bg-layer-1 px-4 py-2.5 text-body-sm-medium text-primary">
        <SectionIcon className="size-4 text-tertiary" />
        {title}
      </h3>
      <dl>{children}</dl>
    </section>
  );
}

function EntryFields(props: { workspaceSlug: string; entry: TTimesheetEntry }) {
  const { workspaceSlug, entry } = props;
  const taskId = `${entry.project.identifier}-${entry.issue.sequence_id}`;
  const dateStart = entry.work_date ? renderFormattedDate(entry.work_date, DATE) : null;
  // entries logged without times are on their one day, as in the export
  const dateEnd = entry.ended_at ? renderFormattedDate(entry.ended_at, DATE) : dateStart;
  const minutes = Math.round(entry.duration);

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-page-x py-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4-medium break-words text-primary">{entry.timesheet_no || "Time entry"}</h2>
        <p className="text-body-xs-regular text-tertiary">
          {personName(entry.logged_by)} · {formatWorklogDuration(entry.duration)} on {taskId}
        </p>
      </div>

      <Section icon={ClockOutline} title="Time Sheet Information">
        <FieldRow
          fields={[
            { label: "Timesheet No.", value: entry.timesheet_no || null },
            {
              label: "Related to",
              value: (
                <Link
                  href={`/${workspaceSlug}/browse/${taskId}/`}
                  className="inline-flex max-w-full items-baseline gap-1.5 text-accent-primary hover:underline"
                  title={entry.issue.name}
                >
                  <span className="shrink-0 text-caption-md-regular text-tertiary">{taskId}</span>
                  <span className="break-words">{entry.issue.name}</span>
                </Link>
              ),
            },
          ]}
        />
        <FieldRow
          fields={[
            { label: "Date start", value: dateStart },
            { label: "Time start", value: entry.started_at ? renderFormattedTime(entry.started_at, "12-hour") : null },
          ]}
        />
        <FieldRow
          fields={[
            { label: "Date end", value: dateEnd },
            { label: "Time end", value: entry.ended_at ? renderFormattedTime(entry.ended_at, "12-hour") : null },
          ]}
        />
        <FieldRow
          fields={[
            { label: "Total time", value: formatWorklogDuration(entry.duration) },
            { label: "Total hours", value: (entry.duration / 60).toFixed(2) },
          ]}
        />
        <FieldRow
          fields={[
            { label: "Total minutes", value: String(minutes) },
            {
              label: "Task status",
              value: entry.state ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: entry.state.color }} />
                  {entry.state.name}
                </span>
              ) : null,
            },
          ]}
        />
        <FieldRow
          fields={[
            {
              label: "Submitted for",
              value: (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Avatar
                    size="xs"
                    alt={entry.logged_by.display_name}
                    fallback={entry.logged_by.display_name?.[0]?.toUpperCase()}
                    src={getFileURL(entry.logged_by.avatar_url ?? "")}
                  />
                  <span className="truncate">{personName(entry.logged_by)}</span>
                </span>
              ),
            },
            { label: "Modified time", value: dateTime(entry.updated_at) },
          ]}
        />
        <FieldRow
          fields={[
            { label: "Created time", value: dateTime(entry.created_at) },
            {
              label: "Project name",
              value: (
                <Link
                  href={`/${workspaceSlug}/projects/${entry.project.id}/issues/`}
                  className="text-accent-primary hover:underline"
                >
                  {entry.project.name}
                </Link>
              ),
            },
          ]}
        />
      </Section>

      <Section icon={TextOutline} title="Description">
        <FieldRow
          fields={[
            { label: "Description", value: entry.description ? <DescriptionText text={entry.description} /> : null },
          ]}
        />
      </Section>
    </div>
  );
}

/** Time Sheet › an entry: every detail of one time entry, laid out as Workplace's detail view. */
export function TimesheetEntryDetail(props: { workspaceSlug: string; entryId: string }) {
  const { workspaceSlug, entryId } = props;
  const { data: entry, error } = useTimesheetEntry(workspaceSlug, entryId);

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <InfoOutline className="size-10 text-placeholder" />
        <p className="text-body-sm-medium text-secondary">
          This time entry doesn&apos;t exist or you can&apos;t see it.
        </p>
        <Link href={timesheetListHref(workspaceSlug)}>
          <Button stretch="auto" variant="secondary" size="md" label="Back to Time Sheet" />
        </Link>
      </div>
    );
  if (!entry)
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 px-page-x py-6" aria-busy="true">
        <div className="h-7 w-56 animate-pulse rounded-sm bg-layer-1" />
        <div className="h-4 w-72 animate-pulse rounded-sm bg-layer-1" />
        <div className="h-72 animate-pulse rounded-lg bg-layer-1" />
      </div>
    );

  return (
    <div className="h-full w-full overflow-y-auto">
      <EntryFields workspaceSlug={workspaceSlug} entry={entry} />
    </div>
  );
}
