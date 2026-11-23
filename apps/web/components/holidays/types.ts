/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** A day off for everyone, or one employees may choose to take (see plane/app/views/holiday/base.py). */
export type THolidayKind = "holiday" | "optional";

export type THoliday = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  name: string;
  kind: THolidayKind;
  description: string;
};

export type THolidayList = {
  year: number;
  /** today in the company's time zone, YYYY-MM-DD */
  today: string;
  /** the years that have holidays */
  years: number[];
  /** workspace admins and HR may change the list */
  can_manage: boolean;
  holidays: THoliday[];
  /** the next holiday from today on, in any year */
  next: THoliday | null;
};

export type THolidayInput = Pick<THoliday, "date" | "name" | "kind" | "description">;

export type THolidayBulkResult = { created: number; skipped: number; message: string; years?: number[] };

/** Why an import was refused; `rows` are the file's rows with a problem. */
export type THolidayImportError = { error?: string; rows?: { row: number; error: string }[] };
