/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type { THoliday, THolidayBulkResult, THolidayInput, THolidayList } from "@/components/holidays/types";
// services
import { APIService } from "@/services/api.service";

/** The company's holiday list: everyone reads it; workspace admins and HR change it. */
export class HolidayService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspaceSlug: string, year?: number): Promise<THolidayList> {
    const query = year ? `?year=${year}` : "";
    return this.get(`/api/workspaces/${workspaceSlug}/holidays/${query}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(workspaceSlug: string, data: THolidayInput): Promise<THoliday> {
    return this.post(`/api/workspaces/${workspaceSlug}/holidays/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(workspaceSlug: string, holidayId: string, data: Partial<THolidayInput>): Promise<THoliday> {
    return this.patch(`/api/workspaces/${workspaceSlug}/holidays/${holidayId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, holidayId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/holidays/${holidayId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** The holidays of one year on the same day and month of another. */
  async copy(workspaceSlug: string, fromYear: number, toYear: number): Promise<THolidayBulkResult> {
    return this.post(`/api/workspaces/${workspaceSlug}/holidays/copy/`, { from_year: fromYear, to_year: toYear })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** A CSV or Excel file with Date and Holiday columns (Type optional). */
  async import(workspaceSlug: string, file: File): Promise<THolidayBulkResult> {
    const form = new FormData();
    form.append("file", file);
    return this.post(`/api/workspaces/${workspaceSlug}/holidays/import/`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}

export const holidayService = new HolidayService();
