/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { mutate as mutateAll } from "swr";
// plane imports
import { Badge } from "@makeplane/propel/components/badge";
import { Button } from "@makeplane/propel/components/button";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import {
  AddOutline,
  CalendarOutline,
  ChevronDownOutline,
  ChevronLeftOutline,
  ChevronRightOutline,
  CopyOutline,
  DeleteOutline,
  EditOutline,
  MoreHorizontalOutline,
  UploadOutline,
} from "@makeplane/propel/icons";
import { Loader } from "@plane/blocks/skeleton";
import { cn } from "@plane/utils";
// local imports
import {
  daysUntil,
  holidayDay,
  holidayFullDate,
  holidayMonth,
  holidayWeekday,
  monthBand,
  twoColumns,
  useHolidays,
  whenText,
} from "./helpers";
import { CopyHolidaysDialog, DeleteHolidayDialog, HolidayFormDialog, ImportHolidaysDialog } from "./holiday-dialogs";
import type { THoliday } from "./types";

type Props = { workspaceSlug: string };

const LOADING_ROWS = ["a", "b", "c", "d", "e", "f"];

function HolidayTile(props: {
  holiday: THoliday;
  today: string;
  isNext: boolean;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { holiday, today, isNext, canManage, onEdit, onDelete } = props;
  const past = holiday.date < today;
  return (
    <li
      className={cn(
        "flex items-center gap-4 rounded-lg px-2 py-2",
        isNext && "bg-accent-subtle ring-[0.5px] ring-accent-strong"
      )}
    >
      <div
        aria-hidden
        className={cn(
          "flex w-14 shrink-0 flex-col overflow-hidden rounded-md border-[0.5px] text-center",
          isNext ? "border-accent-strong" : "border-subtle",
          past && "opacity-60"
        )}
      >
        <span
          className={cn(
            "py-0.5 text-caption-sm-medium tracking-wide",
            past ? "bg-layer-1 text-tertiary" : monthBand(holiday.date)
          )}
        >
          {holidayMonth(holiday.date)}
        </span>
        <span className="bg-surface-1 py-1 text-h5-medium text-primary">{holidayDay(holiday.date)}</span>
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", past && "opacity-60")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body-sm-medium text-primary">{holiday.name}</span>
          {holiday.kind === "optional" && <Badge variant="neutral" size="sm" label="Optional" />}
        </div>
        <span className="text-caption-md-regular text-tertiary">
          <span className="sr-only">{holidayFullDate(holiday.date)}, </span>
          <span aria-hidden>{holidayWeekday(holiday.date)}</span>
          {isNext && <span className="text-accent-primary"> · {whenText(daysUntil(today, holiday.date))}</span>}
          {past && <span className="sr-only"> (past)</span>}
        </span>
        {holiday.description && (
          <span className="truncate text-caption-md-regular text-tertiary" title={holiday.description}>
            {holiday.description}
          </span>
        )}
      </div>
      {canManage && (
        <Menu>
          <MenuTrigger
            render={
              <IconButton
                variant="ghost"
                size="sm"
                icon={<Icon icon={MoreHorizontalOutline} />}
                aria-label={`Actions for ${holiday.name}`}
              />
            }
          />
          <MenuContent side="bottom" align="end">
            <MenuItem label="Edit" icon={<Icon icon={EditOutline} />} onClick={onEdit} />
            <MenuItem label="Delete" icon={<Icon icon={DeleteOutline} />} onClick={onDelete} />
          </MenuContent>
        </Menu>
      )}
    </li>
  );
}

export const HolidaysRoot = observer(function HolidaysRoot({ workspaceSlug }: Props) {
  const [year, setYear] = useState<number | undefined>(undefined);
  const { list, error, isLoading } = useHolidays(workspaceSlug, year);
  const [editing, setEditing] = useState<THoliday | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<THoliday | null>(null);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const thisYear = list ? Number(list.today.slice(0, 4)) : undefined;
  const shownYear = year ?? list?.year ?? thisYear ?? new Date().getFullYear();
  const holidays = list?.year === shownYear ? list.holidays : [];
  const canManage = !!list?.can_manage;
  const today = list?.today ?? "";
  const nextId = list?.next?.id;
  const optionalCount = holidays.filter((holiday) => holiday.kind === "optional").length;
  const previousHasHolidays = !!list?.years.includes(shownYear - 1);
  // another year on its way: the previous year's list isn't this one's
  const loadingYear = isLoading && (!list || list.year !== shownYear);

  /** Every year shown so far, and the Home card, read the list again. */
  const refresh = () =>
    mutateAll((key) => typeof key === "string" && key.startsWith(`HOLIDAYS_${workspaceSlug}_`), undefined, {
      revalidate: true,
    });

  const openForm = (holiday: THoliday | null) => {
    setEditing(holiday);
    setFormOpen(true);
  };
  // a new holiday starts on today in this year, or on 1 January in another
  const defaultDate = shownYear === thisYear && today ? today : `${shownYear}-01-01`;

  const [left, right] = twoColumns(holidays);
  const tile = (holiday: THoliday) => (
    <HolidayTile
      key={holiday.id}
      holiday={holiday}
      today={today}
      isNext={holiday.id === nextId}
      canManage={canManage}
      onEdit={() => openForm(holiday)}
      onDelete={() => setDeleting(holiday)}
    />
  );

  return (
    <div className="flex w-full flex-col gap-5 px-page-x py-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<Icon icon={ChevronLeftOutline} />}
              aria-label={`Holidays in ${shownYear - 1}`}
              onClick={() => setYear(shownYear - 1)}
            />
            <h2 className="min-w-12 text-center text-h5-semibold text-primary" aria-live="polite">
              {shownYear}
            </h2>
            <IconButton
              variant="ghost"
              size="sm"
              icon={<Icon icon={ChevronRightOutline} />}
              aria-label={`Holidays in ${shownYear + 1}`}
              onClick={() => setYear(shownYear + 1)}
            />
          </div>
          {thisYear !== undefined && shownYear !== thisYear && (
            <Button stretch="auto" variant="ghost" size="sm" label="This year" onClick={() => setYear(thisYear)} />
          )}
          {list && (
            <span className="text-body-xs-regular text-tertiary">
              {holidays.length} holiday{holidays.length === 1 ? "" : "s"}
              {optionalCount > 0 && ` · ${optionalCount} optional`}
            </span>
          )}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    stretch="auto"
                    variant="secondary"
                    size="md"
                    label="More"
                    icon={<Icon icon={ChevronDownOutline} />}
                    iconPosition="end"
                  />
                }
              />
              <MenuContent side="bottom" align="end">
                <MenuItem
                  label={`Copy from ${shownYear - 1}`}
                  icon={<Icon icon={CopyOutline} />}
                  disabled={!previousHasHolidays}
                  onClick={() => setCopyFrom(shownYear - 1)}
                />
                <MenuItem
                  label="Import from a file"
                  icon={<Icon icon={UploadOutline} />}
                  onClick={() => setImportOpen(true)}
                />
              </MenuContent>
            </Menu>
            <Button
              stretch="auto"
              variant="primary"
              size="md"
              label="Add holiday"
              icon={<Icon icon={AddOutline} />}
              onClick={() => openForm(null)}
            />
          </div>
        )}
      </div>

      {list?.next && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border-[0.5px] border-subtle bg-layer-1 px-4 py-3 text-body-xs-regular text-secondary">
          <CalendarOutline className="size-4 shrink-0 text-accent-primary" />
          <span>Next holiday:</span>
          <span className="font-medium text-primary">{list.next.name}</span>
          <span>· {holidayFullDate(list.next.date)}</span>
          <span className="text-accent-primary">· {whenText(daysUntil(today, list.next.date))}</span>
          {list.next.kind === "optional" && <Badge variant="neutral" size="sm" label="Optional" />}
        </div>
      )}

      {error && (
        <p className="text-body-xs-regular text-danger-primary">
          {(error as { error?: string })?.error ?? "Couldn't load the holidays. Try again."}
        </p>
      )}

      {loadingYear ? (
        <Loader className="grid gap-3 md:grid-cols-2">
          {LOADING_ROWS.map((row) => (
            <Loader.Item key={row} height="56px" width="100%" />
          ))}
        </Loader>
      ) : holidays.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border-[0.5px] border-subtle px-4 py-12 text-center">
          <CalendarOutline className="size-8 text-placeholder" />
          <div className="flex flex-col gap-1">
            <p className="text-body-sm-medium text-primary">No holidays on the list for {shownYear}</p>
            <p className="text-body-xs-regular text-tertiary">
              {canManage
                ? "Add them one by one, copy last year's list, or import a file exported from Keka."
                : "HR hasn't added this year's holidays yet."}
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button stretch="auto" variant="primary" size="md" label="Add holiday" onClick={() => openForm(null)} />
              {previousHasHolidays && (
                <Button
                  stretch="auto"
                  variant="secondary"
                  size="md"
                  label={`Copy from ${shownYear - 1}`}
                  onClick={() => setCopyFrom(shownYear - 1)}
                />
              )}
              <Button
                stretch="auto"
                variant="secondary"
                size="md"
                label="Import from a file"
                onClick={() => setImportOpen(true)}
              />
            </div>
          )}
        </div>
      ) : (
        <section
          aria-label={`Holidays in ${shownYear}`}
          className={cn(
            "grid gap-x-8 gap-y-1 rounded-lg border-[0.5px] border-subtle p-3 transition-opacity md:grid-cols-2",
            isLoading && "opacity-60"
          )}
        >
          <ul className="flex flex-col gap-1">{left.map(tile)}</ul>
          <ul className="flex flex-col gap-1">{right.map(tile)}</ul>
        </section>
      )}

      {holidays.length > 0 && (
        <p className="text-caption-md-regular text-tertiary">
          Holidays are days off for everyone: Attendance shows them as H, not Absent.
          {optionalCount > 0 && " Optional holidays are ones employees may choose to take; they stay working days."}
        </p>
      )}

      {canManage && (
        <>
          <HolidayFormDialog
            workspaceSlug={workspaceSlug}
            open={formOpen}
            holiday={editing}
            defaultDate={defaultDate}
            onClose={() => setFormOpen(false)}
            onSaved={(saved) => {
              setFormOpen(false);
              setYear(Number(saved.date.slice(0, 4)));
              void refresh();
            }}
          />
          <DeleteHolidayDialog
            workspaceSlug={workspaceSlug}
            holiday={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={() => {
              setDeleting(null);
              void refresh();
            }}
          />
          <CopyHolidaysDialog
            workspaceSlug={workspaceSlug}
            fromYear={copyFrom}
            toYear={shownYear}
            onClose={() => setCopyFrom(null)}
            onCopied={() => {
              setCopyFrom(null);
              void refresh();
            }}
          />
          <ImportHolidaysDialog
            workspaceSlug={workspaceSlug}
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onImported={(years) => {
              setImportOpen(false);
              if (years.length && !years.includes(shownYear)) setYear(years[0]);
              void refresh();
            }}
          />
        </>
      )}
    </div>
  );
});
