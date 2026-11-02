/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// types
import type {
  TWorkItemTimeEstimate,
  TWorkItemTimeEstimatePayload,
  TWorklog,
  TWorklogPayload,
  TWorklogTimer,
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

  // ---------------------------------------------------------------- expected vs worked time

  async getTimeEstimate(workspaceSlug: string, projectId: string, issueId: string): Promise<TWorkItemTimeEstimate> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/time-estimate/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateTimeEstimate(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: TWorkItemTimeEstimatePayload
  ): Promise<TWorkItemTimeEstimate> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/time-estimate/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Work items of the project with an expected time or logged time, keyed by work item id. */
  async projectTimeEstimates(workspaceSlug: string, projectId: string): Promise<Record<string, TWorkItemTimeEstimate>> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/time-estimates/`)
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

  /** Delete timer: removes this timer (by id) without logging any time. */
  async deleteTimer(workspaceSlug: string, timerId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/worklog-timer/?id=${timerId}`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Takes the Stop back so the timer runs on; `timer` is null when it can't (then it's removed, see `reason`). */
  async resumeTimer(workspaceSlug: string): Promise<{ timer: TWorklogTimer | null; reason: string | null }> {
    return this.post(`/api/workspaces/${workspaceSlug}/worklog-timer/resume/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
