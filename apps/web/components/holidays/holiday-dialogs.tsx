/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { Dialog, DialogActions, DialogContent, DialogMain, DialogTitle } from "@makeplane/propel/components/dialog";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { TextArea, TextAreaGroup } from "@makeplane/propel/components/text-area";
import { Select } from "@plane/blocks/select";
import { setToast } from "@plane/blocks/toast";
// services
import { holidayService } from "@/services/holiday.service";
// local imports
import { HOLIDAY_KIND_LABEL, holidayFullDate, SAMPLE_IMPORT_CSV } from "./helpers";
import type { THoliday, THolidayImportError, THolidayInput, THolidayKind } from "./types";

type TKindOption = { value: THolidayKind; label: string };
const KIND_OPTIONS: TKindOption[] = [
  { value: "holiday", label: HOLIDAY_KIND_LABEL.holiday },
  { value: "optional", label: HOLIDAY_KIND_LABEL.optional },
];

const errorText = (error: unknown, fallback: string) => (error as { error?: string } | undefined)?.error ?? fallback;

/** A labelled form row. Without `id` (a picker, not an input) the label is only visual; the picker names itself. */
function Field(props: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {props.id ? (
        <label htmlFor={props.id} className="text-caption-md-medium text-primary">
          {props.label}
        </label>
      ) : (
        <span aria-hidden className="text-caption-md-medium text-primary">
          {props.label}
        </span>
      )}
      {props.children}
      {props.hint && <p className="text-caption-md-regular text-tertiary">{props.hint}</p>}
    </div>
  );
}

/** Add a holiday (holiday null) or change one. `defaultDate` is where a new one starts. */
export function HolidayFormDialog(props: {
  workspaceSlug: string;
  open: boolean;
  holiday: THoliday | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (holiday: THoliday) => void;
}) {
  const { workspaceSlug, open, holiday, defaultDate, onClose, onSaved } = props;
  const [form, setForm] = useState<THolidayInput>({ date: defaultDate, name: "", kind: "holiday", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      holiday
        ? { date: holiday.date, name: holiday.name, kind: holiday.kind, description: holiday.description }
        : { date: defaultDate, name: "", kind: "holiday", description: "" }
    );
    setError(null);
  }, [open, holiday, defaultDate]);

  const save = async () => {
    if (!form.date) return setError("Pick the holiday's date.");
    if (!form.name.trim()) return setError("Give the holiday a name.");
    setSaving(true);
    setError(null);
    try {
      const saved = holiday
        ? await holidayService.update(workspaceSlug, holiday.id, form)
        : await holidayService.create(workspaceSlug, form);
      setToast({
        type: "success",
        title: holiday ? "Holiday updated" : "Holiday added",
        message: `${saved.name}, ${holidayFullDate(saved.date)}.`,
      });
      onSaved(saved);
    } catch (err) {
      setError(errorText(err, "Couldn't save the holiday. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const selectedKind = KIND_OPTIONS.find((option) => option.value === form.kind);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>{holiday ? "Edit holiday" : "Add a holiday"}</DialogTitle>
        </div>
        <DialogMain>
          <form
            id="holiday-form"
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field id="holiday-date" label="Date">
              <InputGroup size="md">
                <Input
                  id="holiday-date"
                  size="md"
                  type="date"
                  required
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                />
              </InputGroup>
            </Field>
            <Field id="holiday-name" label="Name">
              <InputGroup size="md">
                <Input
                  id="holiday-name"
                  size="md"
                  required
                  maxLength={100}
                  placeholder="Diwali"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </InputGroup>
            </Field>
            <Field
              label="Type"
              hint={
                form.kind === "optional"
                  ? "Employees may choose to take it. It stays a working day in Attendance."
                  : "A day off for everyone. Attendance shows it as H, not Absent."
              }
            >
              <Select<TKindOption>
                getValues={() => KIND_OPTIONS}
                value={selectedKind ?? null}
                onChange={(value) => setForm({ ...form, kind: value as THolidayKind })}
                placeholder="Type"
                getOptionValue={(option) => option.value}
                getOptionLabel={(option) => option.label}
                pinSelected={false}
              >
                <Select.Trigger<TKindOption> variant="select-md" className="w-full">
                  <span className="truncate text-left">{selectedKind?.label}</span>
                </Select.Trigger>
              </Select>
            </Field>
            <Field id="holiday-note" label="Note (optional)">
              <TextAreaGroup resize="none">
                <TextArea
                  id="holiday-note"
                  size="md"
                  surface="field"
                  autoResize
                  maxRows={4}
                  maxLength={500}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </TextAreaGroup>
            </Field>
            {error && (
              <p role="alert" className="text-body-xs-regular text-danger-primary">
                {error}
              </p>
            )}
          </form>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={onClose} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            type="submit"
            form="holiday-form"
            label={holiday ? "Save" : "Add holiday"}
            loading={saving}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteHolidayDialog(props: {
  workspaceSlug: string;
  holiday: THoliday | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { workspaceSlug, holiday, onClose, onDeleted } = props;
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!holiday) return;
    setBusy(true);
    try {
      await holidayService.remove(workspaceSlug, holiday.id);
      setToast({ type: "success", title: "Holiday deleted", message: `${holiday.name} is off the list.` });
      onDeleted();
    } catch (err) {
      setToast({ type: "error", title: "Couldn't delete it", message: errorText(err, "Try again.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={holiday !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>{`Delete ${holiday?.name ?? "this holiday"}?`}</DialogTitle>
        </div>
        <DialogMain>
          <p className="px-5 py-4 text-body-xs-regular text-secondary">
            {holiday?.kind === "optional"
              ? `It comes off the holiday list. ${holiday ? holidayFullDate(holiday.date) : ""} was already a working day in Attendance.`
              : `${holiday ? holidayFullDate(holiday.date) : "The day"} becomes a normal working day again, so Attendance counts it as Absent for anyone who logged no time.`}
          </p>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={onClose} />
          <Button stretch="auto" variant="danger" size="md" label="Delete" loading={busy} onClick={remove} />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** Last year's holidays on the same day and month of this year, to adjust the festivals afterwards. */
export function CopyHolidaysDialog(props: {
  workspaceSlug: string;
  fromYear: number | null;
  toYear: number;
  onClose: () => void;
  onCopied: () => void;
}) {
  const { workspaceSlug, fromYear, toYear, onClose, onCopied } = props;
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    if (fromYear === null) return;
    setBusy(true);
    try {
      const result = await holidayService.copy(workspaceSlug, fromYear, toYear);
      setToast({ type: "success", title: `Holidays copied to ${toYear}`, message: result.message });
      onCopied();
    } catch (err) {
      setToast({ type: "error", title: "Couldn't copy them", message: errorText(err, "Try again.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={fromYear !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>{`Copy ${fromYear ?? ""}'s holidays to ${toYear}?`}</DialogTitle>
        </div>
        <DialogMain>
          <ul className="list-disc space-y-1 px-5 py-4 pl-9 text-body-xs-regular text-secondary">
            <li>Each holiday is copied to the same day and month in {toYear}.</li>
            <li>
              Festival dates change every year (Diwali, Holi, Janmashtami…), so check them afterwards and edit the ones
              that moved.
            </li>
            <li>Days that already have a holiday in {toYear} keep theirs.</li>
          </ul>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={onClose} />
          <Button stretch="auto" variant="primary" size="md" label="Copy holidays" loading={busy} onClick={copy} />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** A CSV or Excel file of holidays, e.g. exported from Keka. */
export function ImportHolidaysDialog(props: {
  workspaceSlug: string;
  open: boolean;
  onClose: () => void;
  onImported: (years: number[]) => void;
}) {
  const { workspaceSlug, open, onClose, onImported } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<THolidayImportError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setProblem(null);
  }, [open]);

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE_IMPORT_CSV], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "holidays-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const upload = async () => {
    if (!file) return setProblem({ error: "Choose a .csv or .xlsx file." });
    setBusy(true);
    setProblem(null);
    try {
      const result = await holidayService.import(workspaceSlug, file);
      setToast({ type: "success", title: "Holidays imported", message: result.message });
      onImported(result.years ?? []);
    } catch (err) {
      const refused = (err ?? {}) as THolidayImportError;
      setProblem({ error: refused.error ?? "Couldn't import the file. Try again.", rows: refused.rows });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <div className="px-5 pt-5">
          <DialogTitle>Import holidays</DialogTitle>
        </div>
        <DialogMain>
          <div className="flex flex-col gap-4 px-5 py-4 text-body-xs-regular text-secondary">
            <div className="flex flex-col gap-1.5">
              <p>
                A <span className="font-medium text-primary">.csv</span> or{" "}
                <span className="font-medium text-primary">.xlsx</span> file (for example the holiday list exported from
                Keka) with a header row:
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>
                  <span className="font-medium text-primary">Date</span>: 2026-01-14, 14-01-2026, 14/01/2026 or 14 Jan
                  2026 (day first)
                </li>
                <li>
                  <span className="font-medium text-primary">Holiday</span> (or Name): what the day is
                </li>
                <li>
                  <span className="font-medium text-primary">Type</span> (optional): Holiday, or Optional / Floater
                </li>
              </ul>
              <p>Days already on the list keep their holiday. Nothing is added while any row has a problem.</p>
              <div>
                <Button
                  stretch="auto"
                  variant="ghost"
                  size="sm"
                  label="Download a sample file"
                  onClick={downloadSample}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                id="holiday-import-file"
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setProblem(null);
                  event.target.value = "";
                }}
              />
              <Button
                stretch="auto"
                variant="secondary"
                size="md"
                label={file ? "Choose another file" : "Choose file"}
                onClick={() => inputRef.current?.click()}
              />
              <span className="min-w-0 truncate text-primary">{file?.name ?? "No file chosen"}</span>
            </div>
            {problem && (
              <div role="alert" className="flex flex-col gap-1 rounded-md bg-danger-subtle px-3 py-2">
                <p className="font-medium text-danger-primary">{problem.error}</p>
                {problem.rows?.length ? (
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-danger-primary">
                    {problem.rows.map((row) => (
                      <li key={row.row}>
                        Row {row.row}: {row.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
        </DialogMain>
        <DialogActions>
          <Button stretch="auto" variant="secondary" size="md" label="Cancel" onClick={onClose} />
          <Button
            stretch="auto"
            variant="primary"
            size="md"
            label="Import"
            disabled={!file}
            loading={busy}
            onClick={upload}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
