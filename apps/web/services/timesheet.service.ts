/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type { TTimesheet, TTimesheetQuery } from "@/components/timesheet/types";
// services
import { APIService } from "@/services/api.service";

export class TimesheetService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private params(query: TTimesheetQuery) {
    const params = new URLSearchParams();
    // dates, date filters and exported times in the browser's timezone, as the page shows the times
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) params.set("tz", timezone);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    });
    return params;
  }

  /** Time entries the signed-in person may see (the server decides whose: own, team, levels below). */
  async list(workspaceSlug: string, query: TTimesheetQuery): Promise<TTimesheet> {
    return this.get(`/api/workspaces/${workspaceSlug}/timesheet/?${this.params(query).toString()}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Export Entry: a direct download link (the browser sends the session cookie) for the entries picked, or every
   * entry the filters show when none is picked.
   */
  downloadUrl(workspaceSlug: string, query: TTimesheetQuery, type: "csv" | "xlsx", ids?: string[]) {
    const params = this.params({ ...query, page: undefined, per_page: undefined });
    params.set("type", type);
    if (ids?.length) params.set("ids", ids.join(","));
    return `${API_BASE_URL}/api/workspaces/${workspaceSlug}/timesheet/download/?${params.toString()}`;
  }
}
