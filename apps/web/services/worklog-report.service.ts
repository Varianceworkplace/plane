/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type {
  TWorklogAnalytics,
  TWorklogAnalyticsPeriod,
  TWorklogMonthlyReport,
  TWorklogReportDetail,
  TWorklogReportFilters,
  TWorklogReportGroupBy,
  TWorklogReportListOptions,
  TWorklogReportOptions,
  TWorklogReportSummary,
} from "@/components/worklog-reports/types";
// services
import { APIService } from "@/services/api.service";

export class WorklogReportService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/worklog-reports/`;
  }

  private filterQuery(filters: TWorklogReportFilters, extra: Record<string, string> = {}) {
    const params = new URLSearchParams(extra);
    if (filters.project.length) params.set("project", filters.project.join(","));
    if (filters.logged_by.length) params.set("logged_by", filters.logged_by.join(","));
    if (filters.state_group.length) params.set("state_group", filters.state_group.join(","));
    if (filters.issue?.length) params.set("issue", filters.issue.join(","));
    if (filters.from_date) params.set("from_date", filters.from_date);
    if (filters.to_date) params.set("to_date", filters.to_date);
    if (filters.team?.length) params.set("team", filters.team.join(","));
    if (filters.pm?.length) params.set("pm", filters.pm.join(","));
    if (filters.group?.length) params.set("group", filters.group.join(","));
    return params.toString();
  }

  async analytics(
    workspaceSlug: string,
    filters: TWorklogReportFilters,
    period?: TWorklogAnalyticsPeriod
  ): Promise<TWorklogAnalytics> {
    return this.get(`${this.base(workspaceSlug)}analytics/?${this.filterQuery(filters, period ? { period } : {})}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async options(workspaceSlug: string): Promise<TWorklogReportOptions> {
    return this.get(`${this.base(workspaceSlug)}options/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async summary(workspaceSlug: string, filters: TWorklogReportFilters): Promise<TWorklogReportSummary> {
    return this.get(`${this.base(workspaceSlug)}?${this.filterQuery(filters)}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async monthly(workspaceSlug: string, filters: TWorklogReportFilters): Promise<TWorklogMonthlyReport> {
    return this.get(`${this.base(workspaceSlug)}monthly/?${this.filterQuery(filters)}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async worklogs(
    workspaceSlug: string,
    filters: TWorklogReportFilters,
    page: number,
    perPage: number,
    groupBy?: TWorklogReportGroupBy,
    list: TWorklogReportListOptions = {}
  ): Promise<TWorklogReportDetail> {
    const query = this.filterQuery(filters, {
      page: String(page),
      per_page: String(perPage),
      ...(groupBy ? { group_by: groupBy } : {}),
      ...(list.search ? { search: list.search } : {}),
      ...(list.ordering ? { ordering: list.ordering } : {}),
    });
    return this.get(`${this.base(workspaceSlug)}worklogs/?${query}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Direct download URL; the browser sends the session cookie. */
  downloadUrl(
    workspaceSlug: string,
    filters: TWorklogReportFilters,
    format: "csv" | "xlsx",
    view: "summary" | "monthly" | "worklogs" | "analytics" = "summary",
    groupBy?: TWorklogReportGroupBy,
    period?: TWorklogAnalyticsPeriod
  ) {
    const query = this.filterQuery(filters, {
      type: format,
      view,
      ...(groupBy ? { group_by: groupBy } : {}),
      ...(period ? { period } : {}),
    });
    return `${API_BASE_URL}${this.base(workspaceSlug)}download/?${query}`;
  }
}
