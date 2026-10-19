/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type {
  TWorklog,
  TWorklogPayload,
  TWorklogTimer,
  TWorkspaceWorklogFilters,
  TWorkspaceWorklogResponse,
} from "@/components/worklogs/types";
// services
import { APIService } from "@/services/api.service";

export class WorklogService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private issueBase(workspaceSlug: string, projectId: string, issueId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/worklogs/`;
  }

  private filterQuery(filters: TWorkspaceWorklogFilters, extra: Record<string, string> = {}) {
    const params = new URLSearchParams(extra);
    if (filters.logged_by.length) params.set("logged_by", filters.logged_by.join(","));
    if (filters.project.length) params.set("project", filters.project.join(","));
    if (filters.start) params.set("start", filters.start);
    if (filters.end) params.set("end", filters.end);
    return params.toString();
  }

  async list(workspaceSlug: string, projectId: string, issueId: string): Promise<TWorklog[]> {
    return this.get(this.issueBase(workspaceSlug, projectId, issueId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async create(workspaceSlug: string, projectId: string, issueId: string, data: TWorklogPayload): Promise<TWorklog> {
    return this.post(this.issueBase(workspaceSlug, projectId, issueId), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    worklogId: string,
    data: TWorklogPayload
  ): Promise<TWorklog> {
    return this.patch(`${this.issueBase(workspaceSlug, projectId, issueId)}${worklogId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async remove(workspaceSlug: string, projectId: string, issueId: string, worklogId: string): Promise<void> {
    return this.delete(`${this.issueBase(workspaceSlug, projectId, issueId)}${worklogId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async workspaceWorklogs(
    workspaceSlug: string,
    filters: TWorkspaceWorklogFilters,
    page: number,
    perPage: number
  ): Promise<TWorkspaceWorklogResponse> {
    const query = this.filterQuery(filters, { page: String(page), per_page: String(perPage) });
    return this.get(`/api/workspaces/${workspaceSlug}/worklogs/?${query}`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // ---------------------------------------------------------------- start / stop timer

  async getTimer(workspaceSlug: string): Promise<TWorklogTimer | null> {
    return this.get(`/api/workspaces/${workspaceSlug}/worklog-timer/`)
      .then((response) => response?.data?.timer ?? null)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async startTimer(workspaceSlug: string, projectId: string, issueId: string): Promise<TWorklogTimer> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/worklog-timer/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async stopTimer(workspaceSlug: string): Promise<TWorklogTimer> {
    return this.post(`/api/workspaces/${workspaceSlug}/worklog-timer/stop/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async saveTimer(workspaceSlug: string, description: string): Promise<TWorklog> {
    return this.post(`/api/workspaces/${workspaceSlug}/worklog-timer/save/`, { description })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async discardTimer(workspaceSlug: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/worklog-timer/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Direct download URL; the browser sends the session cookie. */
  downloadUrl(workspaceSlug: string, filters: TWorkspaceWorklogFilters, format: "csv" | "xlsx") {
    return `${API_BASE_URL}/api/workspaces/${workspaceSlug}/worklogs/download/?${this.filterQuery(filters, { type: format })}`;
  }
}
